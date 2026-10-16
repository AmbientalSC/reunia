/// Live insight generation — lightweight analysis of a transcript, shown in the
/// "Insight" tab next to the live transcript while a meeting is being recorded
/// (and, with `completed`, for a meeting that already ended).
///
/// This is intentionally separate from the post-meeting summary/report
/// pipeline (`processor.rs` / `service.rs` / `visual.rs`), which is untouched:
/// no chunking and no "Tela" visual JSON. A single LLM call takes a window of
/// the transcript and returns a small structured payload that the frontend
/// renders directly. Nothing is written here: the frontend saves the result
/// with the meeting through `insight_commands.rs`.
use crate::summary::llm_client::{self, LLMProvider};
use serde::{Deserialize, Deserializer, Serialize};
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
    /// Terms worth explaining (acronyms, companies, people, laws, technical
    /// terms); the UI renders them as clickable chips.
    #[serde(default, deserialize_with = "lenient_strings")]
    pub keywords: Vec<String>,
}

/// Keeps the string entries of a list and ignores everything else (numbers,
/// nulls, nested values): a decorative field must never invalidate the insight.
fn lenient_strings<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<String>, D::Error> {
    let values = Option::<Vec<serde_json::Value>>::deserialize(deserializer)?.unwrap_or_default();

    Ok(values
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect())
}

fn system_prompt(completed: bool) -> String {
    let (task, timing) = if completed {
        (
            "a transcrição de uma reunião JÁ ENCERRADA",
            "a reunião já terminou: considere a transcrição como um todo e dê destaque a decisões, encaminhamentos e pendências finais; nunca diga que ela está em andamento.",
        )
    } else {
        (
            "um trecho RECENTE de uma transcrição em andamento",
            "a reunião ainda está em andamento, então priorize as falas mais recentes.",
        )
    };

    format!(
        r#"Você é o analista de reuniões do ReunIA. Sua tarefa exclusiva é transformar {task} em fatos, temas e próximos passos verificáveis.

REGRAS CRÍTICAS:
- Analise somente o texto fornecido; {timing}
- Registre fatos, temas, perguntas e compromissos que estejam claros.
- Ignore cumprimentos, repetições, ruído, falsos reconhecimentos e trechos truncados.
- Não avalie a qualidade da reunião (não use "caótica", "confusa" ou "desconexa" sem evidência textual explícita).
- Não invente agenda, decisão, identidade ou responsabilidade.
- Se o texto não permitir uma conclusão segura, assuma a incerteza e use attention_points.
- Não use conhecimento externo para completar lacunas.
- Retorne SOMENTE um objeto JSON válido — sem markdown, sem comentários, sem texto antes ou depois.
- Escreva todos os valores de texto em português do Brasil."#
    )
}

/// Largest char boundary at or before `index`.
fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut cut = index.min(text.len());
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    cut
}

/// Smallest char boundary at or after `index`.
fn ceil_char_boundary(text: &str, index: usize) -> usize {
    let mut cut = index.min(text.len());
    while cut < text.len() && !text.is_char_boundary(cut) {
        cut += 1;
    }
    cut
}

/// Truncates the excerpt to fit the model's context budget, always cutting on a
/// valid UTF-8 char boundary (Portuguese text has multi-byte accented
/// characters that a naive byte-slice could panic on).
///
/// While recording, the newest speech matters most, so the end is kept. For a
/// finished meeting both the opening and the closing (where decisions and next
/// steps usually are) are kept and the middle is dropped.
fn truncate_excerpt(text: &str, token_budget: usize, completed: bool) -> String {
    // Reserve room for the system prompt and the JSON output; ~3 chars per
    // token is conservative for both English and Portuguese text.
    let char_budget = token_budget.saturating_sub(900).saturating_mul(3).max(2000);
    if text.len() <= char_budget {
        return text.to_string();
    }

    if completed {
        let head_end = floor_char_boundary(text, char_budget * 2 / 5);
        let tail_start = ceil_char_boundary(text, text.len() - char_budget * 3 / 5);
        format!(
            "{}\n[... trecho do meio omitido ...]\n{}",
            &text[..head_end],
            &text[tail_start..]
        )
    } else {
        let tail_start = ceil_char_boundary(text, text.len() - char_budget);
        format!("[transcrição anterior omitida]\n{}", &text[tail_start..])
    }
}

fn user_prompt(transcript_excerpt: &str, completed: bool) -> String {
    let (tag, recency_rule) = if completed {
        ("transcricao", "considere a reunião inteira")
    } else {
        ("transcricao_parcial", "priorize as falas mais recentes")
    };

    format!(
        r#"Analise o trecho de transcrição abaixo e retorne um objeto JSON com este formato exato:

{{
  "summary": ["até 5 pontos objetivos"],
  "topic": {{"title": "tópico principal", "bullets": ["até 3 insights"], "explanation": "2 ou 3 frases de contexto"}},
  "questions": ["até 3 perguntas de acompanhamento"],
  "actions": ["até 5 ações concretas, somente quando houver"],
  "attention_points": ["até 3 riscos, dúvidas ou informações faltantes, somente quando houver"],
  "keywords": ["até 8 termos que o leitor talvez precise pesquisar"]
}}

Regras para "keywords": escolha siglas, nomes de empresas, órgãos, pessoas, produtos, leis e termos técnicos que foram citados na transcrição e que merecem explicação; copie a grafia como aparece no texto, sem repetir termos e sem palavras comuns.
Regras: diferencie perguntas de ações; não transforme perguntas em ações; use listas vazias quando não houver conteúdo; {recency_rule}; seja conciso.

<{tag}>
{transcript_excerpt}
</{tag}>"#
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

const MAX_KEYWORDS: usize = 8;
const MAX_KEYWORD_CHARS: usize = 60;

/// Trims, drops empty or oversized entries and case-insensitive duplicates,
/// and caps the list: models often repeat terms or return whole sentences.
pub(crate) fn normalize_keywords(keywords: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();

    keywords
        .into_iter()
        .map(|keyword| keyword.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|keyword| {
            !keyword.is_empty()
                && keyword.chars().count() <= MAX_KEYWORD_CHARS
                && seen.insert(keyword.to_lowercase())
        })
        .take(MAX_KEYWORDS)
        .collect()
}

fn parse_live_insight(raw: &str) -> Result<LiveInsightData, String> {
    let value = extract_json_object(raw)?;
    let mut insight: LiveInsightData = serde_json::from_value(value)
        .map_err(|e| format!("Falha ao converter o insight: {}", e))?;
    insight.keywords = normalize_keywords(insight.keywords);
    Ok(insight)
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
    completed: bool,
) -> Result<LiveInsightData, String> {
    if transcript_excerpt.trim().is_empty() {
        return Err("Ainda não há transcrição suficiente para gerar um insight.".to_string());
    }

    let excerpt = truncate_excerpt(transcript_excerpt, token_budget, completed);

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
        &system_prompt(completed),
        &user_prompt(&excerpt, completed),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_keywords_when_present() {
        let raw = r#"{"summary":["a"],"keywords":["LGPD","Tribunal de Contas"]}"#;

        let insight = parse_live_insight(raw).unwrap();

        assert_eq!(insight.keywords, ["LGPD", "Tribunal de Contas"]);
    }

    #[test]
    fn older_payloads_without_keywords_still_parse() {
        let insight = parse_live_insight(r#"{"summary":["a"]}"#).unwrap();

        assert!(insight.keywords.is_empty());
    }

    #[test]
    fn keywords_are_trimmed_deduplicated_and_capped() {
        let mut input: Vec<String> = vec![
            "  LGPD ".into(),
            "lgpd".into(),
            "".into(),
            "Tribunal   de  Contas".into(),
            "x".repeat(MAX_KEYWORD_CHARS + 1),
        ];
        input.extend((0..20).map(|i| format!("termo{i}")));

        let keywords = normalize_keywords(input);

        assert_eq!(keywords[0], "LGPD");
        assert_eq!(keywords[1], "Tribunal de Contas");
        assert_eq!(keywords.len(), MAX_KEYWORDS);
        assert!(!keywords.iter().any(|k| k.chars().count() > MAX_KEYWORD_CHARS));
    }

    #[test]
    fn user_prompt_asks_for_keywords() {
        assert!(user_prompt("texto", false).contains("\"keywords\""));
    }

    #[test]
    fn non_string_keyword_entries_do_not_invalidate_the_insight() {
        let insight =
            parse_live_insight(r#"{"summary":["a"],"keywords":["LGPD",2024,null,{"x":1},"DPO"]}"#)
                .unwrap();

        assert_eq!(insight.keywords, ["LGPD", "DPO"]);
    }

    #[test]
    fn null_or_wrongly_typed_keyword_lists_are_ignored() {
        assert!(parse_live_insight(r#"{"summary":["a"],"keywords":null}"#).unwrap().keywords.is_empty());
    }

    #[test]
    fn live_prompts_focus_on_recent_speech_and_finished_ones_on_the_whole_meeting() {
        let live = system_prompt(false);
        let done = system_prompt(true);

        assert!(live.contains("ainda está em andamento"));
        assert!(done.contains("já terminou"));
        assert!(!done.contains("ainda está em andamento"));
        assert!(user_prompt("t", false).contains("<transcricao_parcial>"));
        assert!(user_prompt("t", true).contains("<transcricao>"));
        assert!(user_prompt("t", true).contains("considere a reunião inteira"));
    }

    #[test]
    fn short_transcripts_are_not_truncated() {
        assert_eq!(truncate_excerpt("curto", 4000, false), "curto");
        assert_eq!(truncate_excerpt("curto", 4000, true), "curto");
    }

    #[test]
    fn live_truncation_keeps_the_newest_speech() {
        let text = format!("INICIO{}FIM", "a".repeat(20_000));

        let result = truncate_excerpt(&text, 1000, false);

        assert!(result.ends_with("FIM"));
        assert!(!result.contains("INICIO"));
        assert!(result.len() < text.len());
    }

    #[test]
    fn finished_meeting_truncation_keeps_the_opening_and_the_closing() {
        let text = format!("INICIO{}FIM", "a".repeat(20_000));

        let result = truncate_excerpt(&text, 1000, true);

        assert!(result.starts_with("INICIO"));
        assert!(result.ends_with("FIM"));
        assert!(result.contains("trecho do meio omitido"));
        assert!(result.len() < text.len());
    }

    #[test]
    fn truncation_never_splits_a_multibyte_character() {
        // 'ç' is two bytes: every cut position is tried across a range of budgets.
        let text = "ç".repeat(9000);

        for budget in 900..1400 {
            let _ = truncate_excerpt(&text, budget, false);
            let _ = truncate_excerpt(&text, budget, true);
        }
    }
}
