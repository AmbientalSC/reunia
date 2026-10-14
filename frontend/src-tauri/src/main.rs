#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    // O logger (arquivo + stdout) é inicializado pelo plugin de log dentro de `app_lib::run()`.
    app_lib::run();
}
