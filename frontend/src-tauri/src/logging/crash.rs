//! Captura de falhas fatais: panics do Rust (com backtrace) e, no Windows, exceções nativas
//! (access violation, instrução ilegal etc.) vindas de drivers de áudio, whisper ou ONNX Runtime,
//! que não passam pelo panic hook e simplesmente derrubam o processo.

use std::any::Any;
use std::backtrace::Backtrace;
use std::path::Path;

pub(super) const CRASH_REPORT_FILE: &str = "crash.log";

/// Registra panics no log (thread, local e backtrace) antes de o processo seguir o fluxo padrão.
/// Panics em callbacks FFI abortam o processo logo depois do hook, então esta é a única pista.
pub fn install_panic_hook() {
    let previous_hook = std::panic::take_hook();

    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "local desconhecido".to_string());

        log::error!(
            "PANIC na thread '{}' em {}: {}\n{}",
            thread.name().unwrap_or("sem nome"),
            location,
            panic_message(info.payload()),
            Backtrace::force_capture()
        );
        log::logger().flush();

        previous_hook(info);
    }));
}

/// Instala o handler de exceções nativas. No-op fora do Windows (macOS/Linux já geram
/// relatórios de crash do próprio sistema).
pub(super) fn install_native_crash_handler(log_dir: &Path) {
    #[cfg(windows)]
    native::install(log_dir);
    #[cfg(not(windows))]
    let _ = log_dir;
}

fn panic_message(payload: &(dyn Any + Send)) -> &str {
    if let Some(message) = payload.downcast_ref::<&str>() {
        message
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.as_str()
    } else {
        "payload do panic não é texto"
    }
}

#[cfg(windows)]
mod native {
    use std::ffi::c_void;
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;

    use super::CRASH_REPORT_FILE;

    const EXCEPTION_CONTINUE_SEARCH: i32 = 0;
    const EXCEPTION_ACCESS_VIOLATION: u32 = 0xC000_0005;
    const GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT: u32 = 0x2;
    const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS: u32 = 0x4;
    const MODULE_PATH_CAPACITY: usize = 520;

    static CRASH_REPORT_PATH: OnceLock<PathBuf> = OnceLock::new();

    // Layout idêntico ao EXCEPTION_RECORD do Windows; nem todos os campos são lidos.
    #[allow(dead_code)]
    #[repr(C)]
    struct ExceptionRecord {
        exception_code: u32,
        exception_flags: u32,
        exception_record: *mut ExceptionRecord,
        exception_address: *mut c_void,
        number_parameters: u32,
        exception_information: [usize; 15],
    }

    #[allow(dead_code)]
    #[repr(C)]
    struct ExceptionPointers {
        exception_record: *mut ExceptionRecord,
        context_record: *mut c_void,
    }

    type TopLevelExceptionFilter = unsafe extern "system" fn(*const ExceptionPointers) -> i32;

    #[link(name = "kernel32")]
    extern "system" {
        fn SetUnhandledExceptionFilter(
            filter: Option<TopLevelExceptionFilter>,
        ) -> Option<TopLevelExceptionFilter>;
        fn GetCurrentThreadId() -> u32;
        fn GetModuleHandleExW(flags: u32, address: *const c_void, module: *mut *mut c_void) -> i32;
        fn GetModuleFileNameW(module: *mut c_void, filename: *mut u16, size: u32) -> u32;
    }

    pub(super) fn install(log_dir: &Path) {
        if CRASH_REPORT_PATH
            .set(log_dir.join(CRASH_REPORT_FILE))
            .is_err()
        {
            return;
        }

        // SAFETY: `on_unhandled_exception` tem a assinatura exigida pelo Windows e só lê os
        // ponteiros recebidos durante a chamada.
        unsafe {
            SetUnhandledExceptionFilter(Some(on_unhandled_exception));
        }
    }

    unsafe extern "system" fn on_unhandled_exception(info: *const ExceptionPointers) -> i32 {
        // SAFETY: o Windows garante que `info` e o `exception_record` apontam para estruturas
        // válidas durante a chamada do filtro; ponteiros nulos são tratados por `as_ref`.
        let record = unsafe { info.as_ref().and_then(|i| i.exception_record.as_ref()) };
        if let Some(record) = record {
            write_report(record);
        }

        // Segue o fluxo padrão (Windows Error Reporting) — só queremos deixar o registro.
        EXCEPTION_CONTINUE_SEARCH
    }

    /// Melhor esforço: evita backtrace/símbolos aqui, o processo está em estado imprevisível.
    fn write_report(record: &ExceptionRecord) {
        let Some(path) = CRASH_REPORT_PATH.get() else {
            return;
        };
        let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
            return;
        };

        let address = record.exception_address as usize;
        // SAFETY: chamada sem argumentos.
        let thread_id = unsafe { GetCurrentThreadId() };

        let _ = writeln!(
            file,
            "[{}] Exceção nativa não tratada: {} (0x{:08X})",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            exception_name(record.exception_code),
            record.exception_code
        );
        // Endereço primeiro: se resolver o módulo travar/falhar, ele já está no arquivo.
        let _ = writeln!(
            file,
            "  thread id: {} | endereço: 0x{:X}",
            thread_id, address
        );
        let _ = writeln!(file, "  módulo: {}", describe_module(address));
        if record.exception_code == EXCEPTION_ACCESS_VIOLATION && record.number_parameters >= 2 {
            let _ = writeln!(
                file,
                "  acesso inválido de {} ao endereço 0x{:X}",
                access_kind(record.exception_information[0]),
                record.exception_information[1]
            );
        }
    }

    /// Descobre a DLL/EXE dona do endereço que falhou (ex.: `audioses.dll`, `onnxruntime.dll`).
    fn describe_module(address: usize) -> String {
        let mut module: *mut c_void = std::ptr::null_mut();
        let flags =
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT;

        // SAFETY: `module` é um ponteiro de saída válido; com FROM_ADDRESS o segundo argumento
        // é interpretado como endereço, não é desreferenciado por nós.
        let found = unsafe { GetModuleHandleExW(flags, address as *const c_void, &mut module) };
        if found == 0 || module.is_null() {
            return "desconhecido".to_string();
        }

        let mut buffer = [0u16; MODULE_PATH_CAPACITY];
        // SAFETY: `buffer` tem exatamente `buffer.len()` posições graváveis.
        let length = unsafe { GetModuleFileNameW(module, buffer.as_mut_ptr(), buffer.len() as u32) }
            as usize;
        let path = String::from_utf16_lossy(&buffer[..length.min(buffer.len())]);

        format!("{}+0x{:X}", path, address.saturating_sub(module as usize))
    }

    fn exception_name(code: u32) -> &'static str {
        match code {
            EXCEPTION_ACCESS_VIOLATION => "ACCESS_VIOLATION",
            0xC000_001D => "ILLEGAL_INSTRUCTION",
            0xC000_00FD => "STACK_OVERFLOW",
            0xC000_0094 => "INTEGER_DIVIDE_BY_ZERO",
            0xC000_0409 => "STACK_BUFFER_OVERRUN",
            0xC000_0374 => "HEAP_CORRUPTION",
            0xE06D_7363 => "EXCEÇÃO_C++_NÃO_TRATADA",
            _ => "EXCEÇÃO_DESCONHECIDA",
        }
    }

    fn access_kind(flag: usize) -> &'static str {
        match flag {
            0 => "leitura",
            1 => "escrita",
            8 => "execução (DEP)",
            _ => "tipo desconhecido",
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn names_known_exception_codes() {
            assert_eq!(exception_name(0xC000_0005), "ACCESS_VIOLATION");
            assert_eq!(exception_name(0xC000_001D), "ILLEGAL_INSTRUCTION");
            assert_eq!(exception_name(0xE06D_7363), "EXCEÇÃO_C++_NÃO_TRATADA");
        }

        #[test]
        fn falls_back_for_unknown_exception_code() {
            assert_eq!(exception_name(0x1234_5678), "EXCEÇÃO_DESCONHECIDA");
        }

        #[test]
        fn describes_access_violation_kind() {
            assert_eq!(access_kind(0), "leitura");
            assert_eq!(access_kind(1), "escrita");
            assert_eq!(access_kind(8), "execução (DEP)");
            assert_eq!(access_kind(99), "tipo desconhecido");
        }

        #[test]
        fn resolves_module_that_owns_a_code_address() {
            let address = resolves_module_that_owns_a_code_address as *const () as usize;

            let description = describe_module(address);

            assert!(
                description.contains('+'),
                "descrição inesperada: {description}"
            );
            assert!(!description.starts_with("desconhecido"));
        }

        #[test]
        fn reports_unknown_module_for_invalid_address() {
            assert_eq!(describe_module(0x10), "desconhecido");
        }

        const CRASH_CHILD_DIR_ENV: &str = "REUNIA_TEST_CRASH_CHILD_DIR";
        const SEM_NOGPFAULTERRORBOX: u32 = 0x2;

        extern "system" {
            fn SetErrorMode(mode: u32) -> u32;
        }

        /// Sobe o próprio binário de teste como processo filho que provoca um access violation
        /// real, e confere o relatório deixado pelo handler.
        #[test]
        fn writes_crash_report_when_process_hits_access_violation() {
            if let Ok(dir) = std::env::var(CRASH_CHILD_DIR_ENV) {
                // SAFETY: suprime a janela do Windows Error Reporting no processo filho.
                unsafe { SetErrorMode(SEM_NOGPFAULTERRORBOX) };
                install(Path::new(&dir));
                // SAFETY: escrita inválida de propósito para disparar a exceção nativa.
                unsafe { std::ptr::write_volatile(0x8 as *mut u32, 1) };
                return;
            }

            let dir = tempfile::tempdir().unwrap();
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "logging::crash::native::tests::writes_crash_report_when_process_hits_access_violation",
                ])
                .env(CRASH_CHILD_DIR_ENV, dir.path())
                .status()
                .unwrap();

            assert!(!status.success());
            let report = std::fs::read_to_string(dir.path().join(CRASH_REPORT_FILE)).unwrap();
            assert!(report.contains("ACCESS_VIOLATION"), "relatório: {report}");
            assert!(
                report.contains("escrita ao endereço 0x8"),
                "relatório: {report}"
            );
            assert!(report.contains("módulo: "), "relatório: {report}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capture_panic_payload(panic: impl FnOnce() + std::panic::UnwindSafe) -> Box<dyn Any + Send> {
        std::panic::catch_unwind(panic).unwrap_err()
    }

    #[test]
    fn extracts_message_from_static_str_payload() {
        let payload = capture_panic_payload(|| panic!("boom"));

        assert_eq!(panic_message(payload.as_ref()), "boom");
    }

    #[test]
    fn extracts_message_from_formatted_payload() {
        let payload = capture_panic_payload(|| panic!("falhou no dispositivo {}", 7));

        assert_eq!(panic_message(payload.as_ref()), "falhou no dispositivo 7");
    }

    #[test]
    fn falls_back_for_non_text_payload() {
        let payload = capture_panic_payload(|| std::panic::panic_any(42_u32));

        assert_eq!(
            panic_message(payload.as_ref()),
            "payload do panic não é texto"
        );
    }
}
