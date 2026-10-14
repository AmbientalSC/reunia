//! Compatibilidade de CPU dos motores locais baseados em ggml (Whisper Local e IA integrada).
//!
//! Esses motores são compilados com baseline AVX2/FMA/F16C/BMI2 (ver `cmake/ggml-portable.cmake`)
//! e não têm detecção em tempo de execução. Em CPUs sem essas instruções (Celeron/Pentium
//! antigos, VMs sem AVX, emulação x64 antiga no Windows ARM) o processo morre com
//! ILLEGAL_INSTRUCTION. Aqui a CPU é verificada antes de entrar nesse código para recusar o
//! motor local com uma mensagem clara; Parakeet e os provedores em nuvem seguem funcionando.

use std::sync::OnceLock;

/// Trecho presente em toda mensagem de incompatibilidade, para o frontend/caller reconhecê-la.
const INCOMPATIBILITY_MARKER: &str = "não é compatível com a CPU";

static MISSING_FEATURES: OnceLock<Vec<&'static str>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalEngine {
    Whisper,
    BuiltInSummary,
}

impl LocalEngine {
    fn label(self) -> &'static str {
        match self {
            LocalEngine::Whisper => "O Whisper Local",
            LocalEngine::BuiltInSummary => "A IA integrada de resumo",
        }
    }

    fn alternative_hint(self) -> &'static str {
        match self {
            LocalEngine::Whisper => {
                "Em Configurações > Transcrição, use o Parakeet ou o Groq Whisper (nuvem)."
            }
            LocalEngine::BuiltInSummary => {
                "Em Configurações > Resumo de IA, escolha outro provedor (por exemplo, o Groq)."
            }
        }
    }
}

/// Instruções do baseline dos motores locais que esta CPU não possui (vazio = compatível).
pub fn missing_cpu_features() -> &'static [&'static str] {
    MISSING_FEATURES.get_or_init(detect_missing_features)
}

/// Retorna erro (já em linguagem de usuário) se a CPU não roda o motor local informado.
pub fn ensure_local_engine_supported(engine: LocalEngine) -> Result<(), String> {
    check_support(engine, missing_cpu_features())
}

/// `true` se `message` foi gerada por [`ensure_local_engine_supported`].
pub fn is_incompatibility_error(message: &str) -> bool {
    message.contains(INCOMPATIBILITY_MARKER)
}

fn check_support(engine: LocalEngine, missing: &[&str]) -> Result<(), String> {
    if missing.is_empty() {
        return Ok(());
    }

    Err(format!(
        "{} {} deste computador (faltam as instruções: {}). {}",
        engine.label(),
        INCOMPATIBILITY_MARKER,
        missing.join(", "),
        engine.alternative_hint()
    ))
}

#[cfg(target_arch = "x86_64")]
fn detect_missing_features() -> Vec<&'static str> {
    [
        ("AVX", std::arch::is_x86_feature_detected!("avx")),
        ("AVX2", std::arch::is_x86_feature_detected!("avx2")),
        ("FMA", std::arch::is_x86_feature_detected!("fma")),
        ("F16C", std::arch::is_x86_feature_detected!("f16c")),
        ("BMI1", std::arch::is_x86_feature_detected!("bmi1")),
        ("BMI2", std::arch::is_x86_feature_detected!("bmi2")),
        ("LZCNT", std::arch::is_x86_feature_detected!("lzcnt")),
    ]
    .into_iter()
    .filter(|(_, present)| !present)
    .map(|(name, _)| name)
    .collect()
}

/// Fora de x86-64 (ex.: Apple Silicon) o ggml usa NEON/Metal, sem exigência de extensões opcionais.
#[cfg(not(target_arch = "x86_64"))]
fn detect_missing_features() -> Vec<&'static str> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_engine_when_cpu_has_every_required_feature() {
        assert_eq!(check_support(LocalEngine::Whisper, &[]), Ok(()));
    }

    #[test]
    fn rejects_whisper_listing_missing_features_and_alternatives() {
        let message = check_support(LocalEngine::Whisper, &["AVX2", "BMI2"]).unwrap_err();

        assert!(message.contains("AVX2, BMI2"));
        assert!(message.contains("Parakeet"));
        assert!(message.contains("Groq"));
    }

    #[test]
    fn rejects_built_in_summary_pointing_to_summary_settings() {
        let message = check_support(LocalEngine::BuiltInSummary, &["AVX2"]).unwrap_err();

        assert!(message.starts_with("A IA integrada de resumo"));
        assert!(message.contains("Resumo de IA"));
    }

    #[test]
    fn recognizes_its_own_error_messages() {
        let message = check_support(LocalEngine::Whisper, &["AVX2"]).unwrap_err();

        assert!(is_incompatibility_error(&message));
        assert!(!is_incompatibility_error(
            "Model parakeet-v3 is not downloaded"
        ));
    }

    #[test]
    fn detects_features_without_panicking_on_this_machine() {
        let first = missing_cpu_features();
        let second = missing_cpu_features();

        assert_eq!(first, second);
    }
}
