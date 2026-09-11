// audio/transcription/groq_provider.rs
//
// Groq Whisper cloud transcription provider.
//
// Implements the TranscriptionProvider trait using the Groq transcription API
// (OpenAI-compatible: POST https://api.groq.com/openai/v1/audio/transcriptions).
//
// Audio contract: the trait receives 16kHz mono f32 samples. The Groq API
// accepts files (wav/flac/mp3/mp4/m4a, <= 25 MB), so we encode samples to a
// WAV (PCM16) byte buffer in memory before uploading via multipart.
//
// NOTE: audio is sent to Groq's cloud - this provider is opt-in and local
// transcription remains the default.

use super::provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
use async_trait::async_trait;
use std::time::Duration;

/// Groq transcription API endpoint
const GROQ_TRANSCRIPTIONS_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";

/// Default Groq Whisper model when none is configured
pub const DEFAULT_GROQ_WHISPER_MODEL: &str = "whisper-large-v3-turbo";

/// Response format from the Groq transcription API (json format)
#[derive(Debug, serde::Deserialize)]
struct GroqTranscriptionResponse {
    text: Option<String>,
}

/// Error body returned by the Groq API on failure
#[derive(Debug, serde::Deserialize)]
struct GroqErrorResponse {
    #[serde(default)]
    error: Option<GroqErrorDetail>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct GroqErrorDetail {
    #[serde(default)]
    message: Option<String>,
}

/// Cloud transcription provider backed by the Groq Whisper API.
pub struct GroqProvider {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl GroqProvider {
    /// Create a new GroqProvider.
    ///
    /// # Arguments
    /// * `api_key` - Groq API key (must be non-empty)
    /// * `model` - Groq Whisper model name (e.g. "whisper-large-v3-turbo")
    pub fn new(api_key: String, model: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            api_key,
            model,
            client,
        }
    }

    /// Transcribe a WAV byte buffer via the Groq API, with retry on
    /// transient failures (429 rate limit and 5xx server errors).
    async fn transcribe_wav_request(
        &self,
        wav_bytes: Vec<u8>,
        language: Option<String>,
    ) -> Result<String, TranscriptionError> {
        let language = filter_language_hint(language);

        const MAX_ATTEMPTS: u32 = 3;

        let mut last_error = TranscriptionError::EngineFailed(
            "Falha ao entrar em contato com a API do Groq".to_string(),
        );

        for attempt in 1..=MAX_ATTEMPTS {
            let form = build_multipart_form(wav_bytes.clone(), &self.model, language.clone());

            let request = self
                .client
                .post(GROQ_TRANSCRIPTIONS_URL)
                .bearer_auth(&self.api_key)
                .multipart(form);

            let response = match request.send().await {
                Ok(resp) => resp,
                Err(e) => {
                    log::warn!(
                        "☁️ Groq transcription request failed (attempt {}/{}): {}",
                        attempt,
                        MAX_ATTEMPTS,
                        e
                    );
                    last_error = TranscriptionError::EngineFailed(format!(
                        "Falha na conexão com a API do Groq: {}",
                        e
                    ));
                    if attempt < MAX_ATTEMPTS {
                        tokio::time::sleep(Duration::from_millis(1000 * attempt as u64)).await;
                    }
                    continue;
                }
            };

            let status = response.status();

            if status.is_success() {
                return match response.json::<GroqTranscriptionResponse>().await {
                    Ok(body) => match body.text {
                        Some(text) if !text.trim().is_empty() => Ok(text.trim().to_string()),
                        _ => Ok(String::new()),
                    },
                    Err(e) => Err(TranscriptionError::EngineFailed(format!(
                        "Falha ao interpretar a resposta do Groq: {}",
                        e
                    ))),
                };
            }

            // Extract a readable error message from the response body
            let error_text = match response.text().await {
                Ok(body) => extract_groq_error_message(&body).unwrap_or_else(|| body),
                Err(_) => String::new(),
            };

            let is_transient = status.as_u16() == 429 || status.is_server_error();

            if is_transient && attempt < MAX_ATTEMPTS {
                log::warn!(
                    "☁️ Groq transcription transient error {} (attempt {}/{}): {}",
                    status,
                    attempt,
                    MAX_ATTEMPTS,
                    error_text
                );
                tokio::time::sleep(Duration::from_millis(1000 * attempt as u64)).await;
                last_error = TranscriptionError::EngineFailed(format!(
                    "Erro temporário da API do Groq (HTTP {}): {}",
                    status, error_text
                ));
                continue;
            }

            return Err(TranscriptionError::EngineFailed(format!(
                "Erro da API do Groq (HTTP {}): {}",
                status, error_text
            )));
        }

        Err(last_error)
    }
}

/// Build the multipart form for a transcription request.
fn build_multipart_form(
    wav_bytes: Vec<u8>,
    model: &str,
    language: Option<String>,
) -> reqwest::multipart::Form {
    let file_part = reqwest::multipart::Part::bytes(wav_bytes)
        .file_name("audio.wav".to_string())
        .mime_str("audio/wav")
        .unwrap_or_else(|_| reqwest::multipart::Part::bytes(Vec::new()));

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", model.to_string())
        .text("response_format", "json".to_string());

    if let Some(lang) = language {
        form = form.text("language", lang);
    }

    form
}

/// Filter invalid language hints ("auto", empty) to None so the Groq API
/// auto-detects the language instead.
fn filter_language_hint(language: Option<String>) -> Option<String> {
    language.and_then(|lang| {
        let trimmed = lang.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Extract a human-readable error message from a Groq error JSON body.
fn extract_groq_error_message(body: &str) -> Option<String> {
    serde_json::from_str::<GroqErrorResponse>(body)
        .ok()
        .and_then(|parsed| {
            parsed
                .error
                .and_then(|detail| detail.message)
                .or(parsed.message)
        })
        .map(|msg| msg.trim().to_string())
        .filter(|msg| !msg.is_empty())
}

/// Encode 16kHz mono f32 samples as a WAV (PCM 16-bit) byte buffer.
///
/// Hand-written RIFF/WAVE writer (44-byte header + PCM data).
pub fn encode_wav_16k_mono(samples: &[f32]) -> Vec<u8> {
    const SAMPLE_RATE: u32 = 16000;
    const CHANNELS: u16 = 1;
    const BITS_PER_SAMPLE: u16 = 16;
    const HEADER_SIZE: u32 = 44;

    let data_len = (samples.len() * (BITS_PER_SAMPLE as usize / 8)) as u32;
    let byte_rate = SAMPLE_RATE * CHANNELS as u32 * (BITS_PER_SAMPLE as u32 / 8);
    let block_align = CHANNELS * (BITS_PER_SAMPLE / 8);

    let mut wav = Vec::with_capacity((HEADER_SIZE as usize) + data_len as usize);

    // RIFF chunk
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // fmt sub-chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    wav.extend_from_slice(&CHANNELS.to_le_bytes());
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());

    // data sub-chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let pcm = (clamped * i16::MAX as f32) as i16;
        wav.extend_from_slice(&pcm.to_le_bytes());
    }

    wav
}

#[async_trait]
impl TranscriptionProvider for GroqProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        // Minimum usable audio: 100ms at 16kHz
        if audio.len() < 1600 {
            return Err(TranscriptionError::AudioTooShort {
                samples: audio.len(),
                minimum: 1600,
            });
        }

        if self.api_key.trim().is_empty() {
            return Err(TranscriptionError::EngineFailed(
                "Chave de API do Groq não configurada".to_string(),
            ));
        }

        let wav_bytes = encode_wav_16k_mono(&audio);
        log::info!(
            "☁️ Groq transcribing {} samples (WAV {} KB) with model '{}'",
            audio.len(),
            wav_bytes.len() / 1024,
            self.model
        );

        let text = self
            .transcribe_wav_request(wav_bytes, language)
            .await?;

        Ok(TranscriptResult {
            text,
            confidence: None, // Groq API does not report per-segment confidence
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        // Stateless cloud provider - considered "ready" when a key is present
        !self.api_key.trim().is_empty()
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }

    fn provider_name(&self) -> &'static str {
        "Groq Whisper (cloud)"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wav_header_is_valid_pcm16_mono_16k() {
        let samples = vec![0.0f32; 16000]; // 1 second of silence
        let wav = encode_wav_16k_mono(&samples);

        assert_eq!(wav.len(), 44 + 16000 * 2);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(u16::from_le_bytes([wav[20], wav[21]]), 1); // PCM
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1); // mono
        assert_eq!(u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]), 16000);
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(
            u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]),
            16000 * 2
        );
    }

    #[test]
    fn test_wav_samples_are_clamped_and_scaled() {
        let samples = vec![1.0f32, -1.0, 2.5, -3.0];
        let wav = encode_wav_16k_mono(&samples);
        let pcm = |i: usize| i16::from_le_bytes([wav[44 + i * 2], wav[45 + i * 2]]);
        assert_eq!(pcm(0), i16::MAX); // 1.0 → +32767
        assert_eq!(pcm(1), -i16::MAX); // -1.0 → -32767 (symmetric scale)
        assert_eq!(pcm(2), i16::MAX); // 2.5 clamped to 1.0
        assert_eq!(pcm(3), -i16::MAX); // -3.0 clamped to -1.0
    }

    #[test]
    fn test_language_hint_filtering() {
        assert_eq!(filter_language_hint(None), None);
        assert_eq!(
            filter_language_hint(Some("auto".to_string())),
            None
        );
        assert_eq!(
            filter_language_hint(Some("AUTO".to_string())),
            None
        );
        assert_eq!(
            filter_language_hint(Some("  ".to_string())),
            None
        );
        assert_eq!(
            filter_language_hint(Some(" pt ".to_string())),
            Some("pt".to_string())
        );
    }
}
