/// Live insight generation — lightweight, real-time analysis of the
/// in-progress transcript, shown in the "Insight" tab next to the live
/// transcript while a meeting is being recorded.
///
/// This is intentionally separate from the post-meeting summary/report
/// pipeline (`processor.rs` / `service.rs` / `visual.rs`), which is untouched:
/// no chunking, no persistence, no "Tela" visual JSON. A single LLM call takes
/// a recent window of the transcript and returns a small structured payload
/// that the frontend renders directly; nothing is written to the database.
use crate::summary::llm_client::{self, LLMProvider};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveInsightTopic {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub bullets: Vec<String>,
    #[serde(default)]
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveInsightData {
    #[serde(default)]
    pub summary: Vec<String>,
    #[serde(default)]
    pub topic: LiveInsightTopic,
    #[serde(default)]
    pub questions: Vec<String>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub attention_points: Vec<String>,
}

fn system_prompt() -> &'static str {
    r#"Você é o analista de reuniões em tempo real do Meetily. Sua tarefa exclusiva é transformar um trecho RECENTE de uma transcrição em andamento em fatos, temas e próximos passos verificáveis.

REGRAS CRÍTICAS:
- Analise somente o texto fornecido; a reunião ainda está em andamento, então priorize as falas mais recentes.
- Registre fatos, temas, perguntas e compromissos que estejam claros.
- Ignore cumprimentos, repetições, ruído, falsos reconhecimentos e trechos truncados.
- Não avalie a qualidade da reunião (não use "caótica", "confusa" ou "desconexa" sem evidência textual explícita).
- Não invente agenda, decisão, identidade ou responsabilidade.
- Se o texto não permitir uma conclusão segura, assuma a incerteza e use attention_points.
- Não use conhecimento externo para completar lacunas.
- Retorne SOMENTE um objeto JSON válido — sem markdown, sem comentários, sem texto antes ou depois.
- Escreva todos os valores de texto em português do Brasil."#
}

/// Truncates the excerpt to fit the model's context budget, cutting on a
/// valid UTF-8 char boundary (mirrors `visual.rs::build_user_prompt`'s
/// truncation, which matters here since Portuguese text has multi-byte
/// accented characters that a naive byte-slice could panic on).
fn truncate_excerpt(text: &str, token_budget: usize) -> String {
    // Reserve room for the system prompt and the JSON output; ~3 chars per
    // token is conservative for both English and Portuguese text.
    let char_budget = token_budget.saturating_sub(900).saturating_mul(3).max(2000);
    if text.len() <= char_budget {
        return text.to_string();
    }

    let mut cut = char_budget;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}\n[transcrição truncada]", &text[..cut])
}

fn user_prompt(transcript_excerpt: &str) -> String {
    format!(
        r#"Analise o trecho de transcrição abaixo e retorne um objeto JSON com este formato exato:

{{
  "summary": ["até 5 pontos objetivos"],
  "topic": {{"title": "tópico principal", "bullets": ["até 3 insights"], "explanation": "2 ou 3 frases de contexto"}},
  "questions": ["até 3 perguntas de acompanhamento"],
  "actions": ["até 5 ações concretas, somente quando houver"],
  "attention_points": ["até 3 riscos, dúvidas ou informações faltantes, somente quando houver"]
}}

Regras: diferencie perguntas de ações; não transforme perguntas em ações; use listas vazias quando não houver conteúdo; priorize as falas mais recentes; seja conciso.

<transcricao_parcial>
{transcript_excerpt}
</transcricao_parcial>"#
    )
}

/// Finds and parses the first top-level JSON object in a raw LLM response,
/// tolerating a wrapping ```json fence or stray text around it.
fn extract_json_object(raw: &str) -> Result<serde_json::Value, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| "A resposta do modelo não contém um objeto JSON".to_string())?;
    let end = raw
        .rfind('}')
        .filter(|&end| end > start)
        .ok_or_else(|| "A resposta do modelo contém um objeto JSON incompleto".to_string())?;

    let value: serde_json::Value = serde_json::from_str(&raw[start..=end])
        .map_err(|e| format!("Falha ao interpretar o JSON do insight: {}", e))?;
    if value.is_object() {
        Ok(value)
    } else {
        Err("A resposta do modelo não é um objeto JSON".to_string())
    }
}

fn parse_live_insight(raw: &str) -> Result<LiveInsightData, String> {
    let value = extract_json_object(raw)?;
    serde_json::from_value(value).map_err(|e| format!("Falha ao converter o insight: {}", e))
}

#[allow(clippy::too_many_arguments)]
pub async fn generate_live_insight(
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    transcript_excerpt: &str,
    token_budget: usize,
) -> Result<LiveInsightData, String> {
    if transcript_excerpt.trim().is_empty() {
        return Err("Ainda não há transcrição suficiente para gerar um insight.".to_string());
    }

    let excerpt = truncate_excerpt(transcript_excerpt, token_budget);

    info!(
        "Generating live insight (provider: {:?}, model: {}, excerpt chars: {})",
        provider,
        model_name,
        excerpt.len()
    );

    let client = reqwest::Client::new();
    let raw = llm_client::generate_summary(
        &client,
        provider,
        model_name,
        api_key,
        system_prompt(),
        &user_prompt(&excerpt),
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        None,
    )
    .await?;

    parse_live_insight(&raw)
}
