//! Ciclo de vida da sessão: detecta término inesperado da sessão anterior e registra
//! informações da máquina no início de cada execução.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use sysinfo::{ProcessesToUpdate, System};

use super::crash::CRASH_REPORT_FILE;

const SESSION_MARKER_FILE: &str = "session.lock";
const PREVIOUS_CRASH_REPORT_FILE: &str = "crash-previous.log";
const BYTES_PER_MB: u64 = 1024 * 1024;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

pub(super) fn begin(log_dir: &Path, app_version: &str) {
    let _ = LOG_DIR.set(log_dir.to_path_buf());

    report_previous_session(log_dir, app_version);
    log_system_info(app_version, log_dir);

    if let Err(e) = write_marker(log_dir, app_version) {
        log::warn!("Não foi possível gravar o marcador de sessão: {}", e);
    }
}

pub(super) fn end() {
    let Some(log_dir) = LOG_DIR.get() else {
        return;
    };

    if let Err(e) = fs::remove_file(log_dir.join(SESSION_MARKER_FILE)) {
        log::warn!("Não foi possível remover o marcador de sessão: {}", e);
    }
    log::info!("Sessão encerrada normalmente");
}

/// Registra no log como a sessão anterior terminou. Retorna `true` quando ela terminou de forma
/// inesperada (marcador de sessão ainda presente ou relatório de crash nativo).
fn report_previous_session(log_dir: &Path, current_version: &str) -> bool {
    let marker_path = log_dir.join(SESSION_MARKER_FILE);
    let mut ended_unexpectedly = false;

    if let Ok(previous) = fs::read_to_string(&marker_path) {
        match marker_version(&previous) {
            // O updater do Tauri encerra o processo no Windows sem passar por `RunEvent::Exit`,
            // então o marcador de uma versão anterior indica atualização, não crash.
            Some(previous_version) if previous_version != current_version => log::info!(
                "A sessão anterior (v{}) não registrou encerramento normal; provável \
                 atualização para v{}",
                previous_version,
                current_version
            ),
            _ => {
                ended_unexpectedly = true;
                log::warn!(
                    "A sessão anterior terminou de forma inesperada (crash, encerramento \
                     forçado ou desligamento do Windows). Marcador: {}",
                    previous.trim().replace('\n', " | ")
                );
            }
        }
    }

    let crash_path = log_dir.join(CRASH_REPORT_FILE);
    match fs::read_to_string(&crash_path) {
        Ok(report) if !report.trim().is_empty() => {
            ended_unexpectedly = true;
            log::error!(
                "Crash nativo registrado na sessão anterior:\n{}",
                report.trim_end()
            );
            if let Err(e) = fs::rename(&crash_path, log_dir.join(PREVIOUS_CRASH_REPORT_FILE)) {
                log::warn!("Não foi possível arquivar o relatório de crash: {}", e);
            }
        }
        _ => {}
    }

    ended_unexpectedly
}

fn marker_version(marker: &str) -> Option<&str> {
    marker
        .lines()
        .find_map(|line| line.strip_prefix("version="))
        .map(str::trim)
}

fn write_marker(log_dir: &Path, app_version: &str) -> std::io::Result<()> {
    fs::create_dir_all(log_dir)?;
    fs::write(
        log_dir.join(SESSION_MARKER_FILE),
        format!(
            "pid={}\nversion={}\nstarted_at={}\n",
            std::process::id(),
            app_version,
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        ),
    )
}

fn log_system_info(app_version: &str, log_dir: &Path) {
    let mut system = System::new();
    system.refresh_memory();
    system.refresh_cpu_all();

    let cpu = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .unwrap_or_else(|| "desconhecida".to_string());

    log::info!(
        "ReunIA {} iniciado | SO: {} | CPU: {} ({} threads{}) | RAM: {} MB total, {} MB livre | logs: {}",
        app_version,
        System::long_os_version().unwrap_or_else(|| "desconhecido".to_string()),
        cpu,
        system.cpus().len(),
        cpu_features(),
        system.total_memory() / BYTES_PER_MB,
        system.available_memory() / BYTES_PER_MB,
        log_dir.display()
    );
}

/// Registra memória livre da máquina e uso do processo. Falta de RAM (modelos de transcrição
/// grandes) derruba o processo por abort do alocador, sem panic nem exceção para registrar.
pub fn log_memory_snapshot(context: &str) {
    let mut system = System::new();
    system.refresh_memory();

    let process_mb = sysinfo::get_current_pid().ok().and_then(|pid| {
        system.refresh_processes(ProcessesToUpdate::Some(&[pid]), false);
        system
            .process(pid)
            .map(|process| process.memory() / BYTES_PER_MB)
    });

    log::info!(
        "Memória ({}): {} MB livres de {} MB | processo: {}",
        context,
        system.available_memory() / BYTES_PER_MB,
        system.total_memory() / BYTES_PER_MB,
        process_mb.map_or_else(|| "n/d".to_string(), |mb| format!("{} MB", mb))
    );
}

/// Extensões de CPU exigidas pelo whisper/ONNX; a falta delas costuma causar crash por
/// instrução ilegal apenas em máquinas antigas.
#[cfg(target_arch = "x86_64")]
fn cpu_features() -> String {
    format!(
        ", avx={} avx2={} fma={}",
        std::arch::is_x86_feature_detected!("avx"),
        std::arch::is_x86_feature_detected!("avx2"),
        std::arch::is_x86_feature_detected!("fma")
    )
}

#[cfg(not(target_arch = "x86_64"))]
fn cpu_features() -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_clean_start_when_no_marker_exists() {
        let dir = tempfile::tempdir().unwrap();

        assert!(!report_previous_session(dir.path(), "0.4.5"));
    }

    #[test]
    fn reports_unexpected_end_when_marker_was_left_behind() {
        let dir = tempfile::tempdir().unwrap();
        write_marker(dir.path(), "0.4.5").unwrap();

        assert!(report_previous_session(dir.path(), "0.4.5"));
    }

    #[test]
    fn treats_marker_from_older_version_as_update_not_crash() {
        let dir = tempfile::tempdir().unwrap();
        write_marker(dir.path(), "0.4.4").unwrap();

        assert!(!report_previous_session(dir.path(), "0.4.5"));
    }

    #[test]
    fn extracts_version_from_marker() {
        assert_eq!(
            marker_version(
                "pid=1
version=0.4.5
started_at=x
"
            ),
            Some("0.4.5")
        );
        assert_eq!(
            marker_version(
                "pid=1
"
            ),
            None
        );
    }

    #[test]
    fn marker_contains_pid_and_version() {
        let dir = tempfile::tempdir().unwrap();

        write_marker(dir.path(), "0.4.5").unwrap();

        let content = fs::read_to_string(dir.path().join(SESSION_MARKER_FILE)).unwrap();
        assert!(content.contains(&format!("pid={}", std::process::id())));
        assert!(content.contains("version=0.4.5"));
    }

    #[test]
    fn archives_native_crash_report_from_previous_session() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(CRASH_REPORT_FILE),
            "ACCESS_VIOLATION em audioses.dll",
        )
        .unwrap();

        assert!(report_previous_session(dir.path(), "0.4.5"));

        assert!(!dir.path().join(CRASH_REPORT_FILE).exists());
        let archived = fs::read_to_string(dir.path().join(PREVIOUS_CRASH_REPORT_FILE)).unwrap();
        assert!(archived.contains("audioses.dll"));
    }

    #[test]
    fn ignores_empty_crash_report() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(CRASH_REPORT_FILE), "  \n").unwrap();

        assert!(!report_previous_session(dir.path(), "0.4.5"));
    }
}
