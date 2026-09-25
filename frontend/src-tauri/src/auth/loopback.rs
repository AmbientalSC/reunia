use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const SUCCESS_PAGE: &str = r#"<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Login concluído</title></head>
<body style="font-family: sans-serif; text-align: center; padding-top: 4rem;">
<h2>Login concluído</h2>
<p>Você já pode fechar esta aba e voltar para o ReunIA.</p>
</body></html>"#;

const ERROR_PAGE: &str = r#"<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Falha no login</title></head>
<body style="font-family: sans-serif; text-align: center; padding-top: 4rem;">
<h2>Não foi possível concluir o login</h2>
<p>Feche esta aba e tente novamente no ReunIA.</p>
</body></html>"#;

/// A one-shot local HTTP listener used to capture the OAuth redirect
/// (`http://localhost:{port}/?code=...&state=...`) from the system browser.
pub struct LoopbackServer {
    listener: TcpListener,
    port: u16,
}

impl LoopbackServer {
    /// Binds to a free port on 127.0.0.1. Call `port()` to build the
    /// `redirect_uri` before opening the browser, then `wait_for_code`.
    pub async fn bind() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Falha ao iniciar o servidor local de login: {}", e))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Falha ao obter a porta do servidor local: {}", e))?
            .port();
        Ok(Self { listener, port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Accepts exactly one connection, extracts `code`/`state` from the
    /// callback URL, validates `state`, and responds with a small HTML page.
    pub async fn wait_for_code(
        self,
        expected_state: &str,
        timeout: Duration,
    ) -> Result<String, String> {
        let (mut stream, _) = tokio::time::timeout(timeout, self.listener.accept())
            .await
            .map_err(|_| "Tempo esgotado aguardando o login no navegador".to_string())?
            .map_err(|e| format!("Falha ao aceitar a conexão de callback: {}", e))?;

        let request_line = read_request_line(&mut stream).await?;
        let (code, state) = parse_callback_query(&request_line)?;

        if state != expected_state {
            respond(&mut stream, ERROR_PAGE).await;
            return Err("Parâmetro state inválido no retorno do login (possível CSRF)".to_string());
        }

        respond(&mut stream, SUCCESS_PAGE).await;
        Ok(code)
    }
}

async fn read_request_line(stream: &mut tokio::net::TcpStream) -> Result<String, String> {
    let mut buf = vec![0u8; 8192];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Falha ao ler a requisição de callback: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);
    request
        .lines()
        .next()
        .map(str::to_string)
        .ok_or_else(|| "Requisição de callback vazia".to_string())
}

fn parse_callback_query(request_line: &str) -> Result<(String, String), String> {
    // Expected: "GET /?code=...&state=... HTTP/1.1"
    let path_and_query = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Requisição de callback malformada".to_string())?;

    let url = url::Url::parse(&format!("http://localhost{}", path_and_query))
        .map_err(|e| format!("Falha ao interpretar a URL de callback: {}", e))?;

    let mut code = None;
    let mut state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => {
                let description = url
                    .query_pairs()
                    .find(|(k, _)| k == "error_description")
                    .map(|(_, v)| v.into_owned())
                    .unwrap_or_else(|| value.into_owned());
                return Err(format!("Login cancelado ou negado: {}", description));
            }
            _ => {}
        }
    }

    match (code, state) {
        (Some(code), Some(state)) => Ok((code, state)),
        _ => Err("Callback de login sem 'code'/'state'".to_string()),
    }
}

async fn respond(stream: &mut tokio::net::TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}
