//! Log persistente em arquivo e diagnóstico de crashes.
//!
//! No Windows o build de release usa `windows_subsystem = "windows"` (sem console), então
//! tudo que ia para stdout/stderr se perdia e não havia como investigar um fechamento
//! inesperado. Aqui os logs vão para o diretório de logs do app
//! (`%LOCALAPPDATA%\com.ambiental.reunia\logs` no Windows), com rotação por tamanho.
//!
//! Arquivos gerados nessa pasta:
//! - `reunia.log` (+ rotacionados): log da aplicação, backend e frontend;
//! - `crash.log`: exceção nativa (ex.: access violation em driver de áudio/DLL), Windows;
//! - `session.lock`: marcador que só existe enquanto o app está rodando, usado para
//!   detectar que a sessão anterior terminou de forma inesperada.

mod crash;
mod session;

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

pub use crash::install_panic_hook;
pub use session::log_memory_snapshot;

const LOG_FILE_NAME: &str = "reunia";
const MAX_LOG_FILE_BYTES: u128 = 5 * 1024 * 1024;
const LOG_FILES_TO_KEEP: usize = 7;

const FRONTEND_LOG_TARGET: &str = "frontend";
const MAX_FRONTEND_MESSAGE_CHARS: usize = 4_000;

/// Plugin que inicializa o logger global (arquivo + stdout). Deve ser registrado no builder antes
/// dos demais plugins. Nunca falha o `setup`: o log não pode impedir o app de abrir.
pub fn build_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("reunia-logging")
        .setup(|app, _api| {
            init_logger(app);
            Ok(())
        })
        .build()
}

/// Tenta log em arquivo + stdout; se o arquivo não puder ser usado (diretório sem permissão,
/// arquivo bloqueado por outro programa durante a rotação), cai para stdout apenas.
fn init_logger<R: Runtime>(app: &AppHandle<R>) {
    let file_and_stdout = [
        Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.to_string()),
        }),
        Target::new(TargetKind::Stdout),
    ];
    let Err(file_error) = attach_logger(app, file_and_stdout) else {
        return;
    };

    eprintln!("Log em arquivo indisponível, usando apenas stdout: {file_error}");
    if let Err(e) = attach_logger(app, [Target::new(TargetKind::Stdout)]) {
        eprintln!("Não foi possível inicializar o logger: {e}");
    }
}

fn attach_logger<R: Runtime>(
    app: &AppHandle<R>,
    targets: impl IntoIterator<Item = Target>,
) -> Result<(), String> {
    // `split` devolve também um plugin com o comando `log` do JS, que não usamos.
    let (_plugin, max_level, logger) = tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .targets(targets)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(LOG_FILES_TO_KEEP))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .split(app)
        .map_err(|e| e.to_string())?;

    tauri_plugin_log::attach_logger(max_level, logger).map_err(|e| e.to_string())
}

/// Inicia a sessão de diagnóstico: instala o handler de crash nativo, reporta como a sessão
/// anterior terminou e registra informações da máquina. Chamar no início do `setup`.
pub fn begin_session<R: Runtime>(app: &AppHandle<R>) {
    let log_dir = match app.path().app_log_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("Não foi possível resolver o diretório de logs: {}", e);
            return;
        }
    };

    crash::install_native_crash_handler(&log_dir);
    session::begin(&log_dir, &app.package_info().version.to_string());
}

/// Marca a sessão como encerrada normalmente. Chamar apenas em saída limpa do app.
pub fn end_session() {
    session::end();
}

fn resolve_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map_err(|e| format!("Falha ao obter o diretório de logs: {}", e))
}

#[tauri::command]
pub fn get_log_directory(app: AppHandle) -> Result<String, String> {
    resolve_log_dir(&app).map(|dir| dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_log_folder(app: AppHandle) -> Result<(), String> {
    let log_dir = resolve_log_dir(&app)?;
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Falha ao criar o diretório de logs: {}", e))?;

    open_in_file_manager(&log_dir)?;
    log::info!("Pasta de logs aberta: {}", log_dir.display());
    Ok(())
}

/// Recebe erros/avisos do frontend (window.onerror, promises rejeitadas, console.error) para
/// que fiquem no mesmo arquivo de log do backend.
#[tauri::command]
pub fn log_frontend_event(level: String, message: String) {
    let level = match level.as_str() {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        _ => log::Level::Info,
    };
    log::log!(target: FRONTEND_LOG_TARGET, level, "{}", truncate_message(&message));
}

/// Limita o tamanho de uma mensagem vinda do frontend para que um loop de erros não encha o disco.
fn truncate_message(message: &str) -> Cow<'_, str> {
    match message.char_indices().nth(MAX_FRONTEND_MESSAGE_CHARS) {
        None => Cow::Borrowed(message),
        Some((cut_at, _)) => Cow::Owned(format!(
            "{}… [truncado: {} caracteres no total]",
            &message[..cut_at],
            message.chars().count()
        )),
    }
}

fn open_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";

    std::process::Command::new(opener)
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Falha ao abrir a pasta: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_short_message_untouched() {
        let message = "falha ao iniciar gravação";

        assert!(matches!(truncate_message(message), Cow::Borrowed(m) if m == message));
    }

    #[test]
    fn keeps_message_at_exact_limit() {
        let message = "a".repeat(MAX_FRONTEND_MESSAGE_CHARS);

        assert_eq!(truncate_message(&message), message);
    }

    #[test]
    fn truncates_long_message_and_reports_total_length() {
        let message = "a".repeat(MAX_FRONTEND_MESSAGE_CHARS + 500);

        let truncated = truncate_message(&message);

        assert!(truncated.starts_with(&"a".repeat(MAX_FRONTEND_MESSAGE_CHARS)));
        assert!(truncated.contains(&format!("{} caracteres", MAX_FRONTEND_MESSAGE_CHARS + 500)));
    }

    #[test]
    fn truncates_on_char_boundary_for_multibyte_text() {
        let message = "ç".repeat(MAX_FRONTEND_MESSAGE_CHARS + 10);

        let truncated = truncate_message(&message);

        assert!(truncated.starts_with(&"ç".repeat(MAX_FRONTEND_MESSAGE_CHARS)));
    }
}
