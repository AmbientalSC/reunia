//! Persistence for user-created templates.
//!
//! Custom templates live as `<id>.json` files in the user's data directory
//! (see `loader::custom_templates_dir`). Built-in and bundled templates are
//! never modified here: the UI can only create, edit and delete files in the
//! custom directory.

use super::loader;
use super::types::Template;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use tracing::info;

/// Serialises writes so two concurrent saves cannot pick the same generated id
/// or share a temp file. Template edits are rare, so a single lock is plenty.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn lock_writes() -> MutexGuard<'static, ()> {
    WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Prefix of generated ids, so a user template never shadows a built-in one.
const GENERATED_ID_PREFIX: &str = "custom_";
const MAX_SLUG_CHARS: usize = 40;
const MAX_ID_CHARS: usize = 100;
const FALLBACK_SLUG: &str = "modelo";

/// Whether `id` is safe to use as a file name stem.
///
/// Template ids come from the frontend and end up in a file path, so this is a
/// whitelist: letters, digits and a few punctuation marks that are common in
/// hand-named files (`ata.v2`, `reuniao (1)`). Path separators, `:` (drive
/// letters, NTFS streams), `~`, `$`, control characters and ids made only of
/// dots are rejected.
pub fn is_safe_template_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().count() <= MAX_ID_CHARS
        && !id.chars().all(|c| c == '.')
        && id.chars().all(|c| {
            c.is_alphanumeric() || matches!(c, '_' | '-' | ' ' | '.' | '(' | ')' | '@' | '+')
        })
}

fn fold_to_ascii(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        other => other,
    }
}

/// Turns a display name into a lowercase ASCII identifier (`Ata de Diretoria` -> `ata_de_diretoria`).
fn slugify(name: &str) -> String {
    let folded: String = name
        .chars()
        .flat_map(char::to_lowercase)
        .map(fold_to_ascii)
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();

    let slug = folded
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_");

    let truncated: String = slug.chars().take(MAX_SLUG_CHARS).collect();
    let truncated = truncated.trim_end_matches('_');

    if truncated.is_empty() {
        FALLBACK_SLUG.to_string()
    } else {
        truncated.to_string()
    }
}

/// Builds an id from `name` that `is_taken` does not already know about.
fn generate_unique_id(name: &str, is_taken: impl Fn(&str) -> bool) -> String {
    let base = format!("{GENERATED_ID_PREFIX}{}", slugify(name));
    if !is_taken(&base) {
        return base;
    }

    (2..)
        .map(|n| format!("{base}_{n}"))
        .find(|candidate| !is_taken(candidate))
        .expect("an unbounded range always yields a free candidate")
}

fn template_path(dir: &Path, id: &str) -> std::path::PathBuf {
    dir.join(format!("{id}.json"))
}

/// Whether `id` refers to a file in `dir` (i.e. a template the user can edit or delete).
pub(super) fn is_custom_in_dir(dir: &Path, id: &str) -> bool {
    is_safe_template_id(id) && template_path(dir, id).is_file()
}

/// Validates and writes a template into `dir`, returning its id.
///
/// `id = None` creates a new template with a generated id; `id = Some(..)`
/// overwrites an existing custom template.
pub(super) fn save_in_dir(
    dir: &Path,
    id: Option<&str>,
    template: &Template,
    is_id_taken: impl Fn(&str) -> bool,
) -> Result<String, String> {
    let template = template.normalized();
    template.validate_for_save()?;

    let _guard = lock_writes();

    let id = match id {
        Some(existing) if is_custom_in_dir(dir, existing) => existing.to_string(),
        Some(_) => return Err("Modelo personalizado não encontrado".to_string()),
        None => generate_unique_id(&template.name, |candidate| {
            is_id_taken(candidate) || template_path(dir, candidate).exists()
        }),
    };

    fs::create_dir_all(dir)
        .map_err(|e| format!("Falha ao criar a pasta de modelos personalizados: {e}"))?;

    let json = serde_json::to_string_pretty(&template)
        .map_err(|e| format!("Falha ao serializar o modelo: {e}"))?;

    // Write to a sibling temp file first so a crash never leaves a truncated template behind.
    let final_path = template_path(dir, &id);
    let temp_path = dir.join(format!("{id}.json.tmp"));
    fs::write(&temp_path, json).map_err(|e| format!("Falha ao salvar o modelo: {e}"))?;
    if let Err(e) = fs::rename(&temp_path, &final_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Falha ao salvar o modelo: {e}"));
    }

    info!("Saved custom template '{}' to {:?}", id, final_path);
    Ok(id)
}

/// Deletes the custom template `id` from `dir`.
pub(super) fn delete_in_dir(dir: &Path, id: &str) -> Result<(), String> {
    let _guard = lock_writes();

    if !is_custom_in_dir(dir, id) {
        return Err("Modelo personalizado não encontrado".to_string());
    }

    fs::remove_file(template_path(dir, id))
        .map_err(|e| format!("Falha ao excluir o modelo: {e}"))?;

    info!("Deleted custom template '{}'", id);
    Ok(())
}

fn custom_dir() -> Result<std::path::PathBuf, String> {
    loader::custom_templates_dir()
        .ok_or_else(|| "Não foi possível localizar a pasta de dados do aplicativo".to_string())
}

/// Whether `id` is a user-created (editable) template.
pub fn is_custom_template(id: &str) -> bool {
    loader::custom_templates_dir().is_some_and(|dir| is_custom_in_dir(&dir, id))
}

/// Creates (`id = None`) or updates a custom template and returns its id.
pub fn save_custom_template(id: Option<&str>, template: &Template) -> Result<String, String> {
    let existing_ids = loader::list_template_ids();
    save_in_dir(&custom_dir()?, id, template, |candidate| {
        existing_ids.iter().any(|existing| existing == candidate)
    })
}

/// Deletes a custom template. Built-in templates cannot be deleted.
pub fn delete_custom_template(id: &str) -> Result<(), String> {
    delete_in_dir(&custom_dir()?, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::templates::TemplateSection;
    use tempfile::tempdir;

    fn sample_template(name: &str) -> Template {
        Template {
            name: name.to_string(),
            description: "Descrição".to_string(),
            sections: vec![TemplateSection {
                title: "Resumo".to_string(),
                instruction: "Resuma a reunião".to_string(),
                format: "paragraph".to_string(),
                item_format: None,
                example_item_format: None,
            }],
        }
    }

    fn nothing_taken(_: &str) -> bool {
        false
    }

    #[test]
    fn accepts_regular_ids() {
        assert!(is_safe_template_id("daily_standup"));
        assert!(is_safe_template_id("custom_ata-diretoria"));
        assert!(is_safe_template_id("Meu Modelo"));
    }

    #[test]
    fn accepts_punctuation_common_in_hand_named_files() {
        for id in ["ata.v2", "reuniao (1)", "ata@2024", "ata+extra"] {
            assert!(is_safe_template_id(id), "'{id}' should be accepted");
        }
    }

    #[test]
    fn rejects_ids_that_could_escape_the_templates_dir() {
        for id in [
            "",
            ".",
            "..",
            "../secret",
            "a/b",
            "a\\b",
            "C:\\x",
            "a:b",
            "x::$DATA",
            "\\\\srv\\sh\\x",
            "PROGRA~1",
            "a\0b",
            "a\nb",
        ] {
            assert!(!is_safe_template_id(id), "'{id}' should be rejected");
        }
    }

    #[test]
    fn slugify_folds_accents_and_punctuation() {
        assert_eq!(slugify("Ata de Reunião — Diretoria!"), "ata_de_reuniao_diretoria");
    }

    #[test]
    fn slugify_falls_back_when_nothing_usable_remains() {
        assert_eq!(slugify("???"), FALLBACK_SLUG);
    }

    #[test]
    fn slugify_truncates_long_names() {
        let slug = slugify(&"a".repeat(200));

        assert_eq!(slug.chars().count(), MAX_SLUG_CHARS);
    }

    #[test]
    fn generate_unique_id_appends_counter_on_collision() {
        let taken = ["custom_ata", "custom_ata_2"];

        let id = generate_unique_id("Ata", |candidate| taken.contains(&candidate));

        assert_eq!(id, "custom_ata_3");
    }

    #[test]
    fn save_creates_a_new_file_with_generated_id() {
        let dir = tempdir().unwrap();

        let id = save_in_dir(dir.path(), None, &sample_template("Ata Semanal"), nothing_taken)
            .unwrap();

        assert_eq!(id, "custom_ata_semanal");
        assert!(dir.path().join("custom_ata_semanal.json").is_file());
    }

    #[test]
    fn save_creates_the_directory_when_missing() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("nested").join("templates");

        let result = save_in_dir(&nested, None, &sample_template("Ata"), nothing_taken);

        assert!(result.is_ok());
        assert!(nested.is_dir());
    }

    #[test]
    fn saved_file_round_trips_through_the_parser() {
        let dir = tempdir().unwrap();
        let id = save_in_dir(dir.path(), None, &sample_template("Ata"), nothing_taken).unwrap();

        let raw = fs::read_to_string(dir.path().join(format!("{id}.json"))).unwrap();
        let parsed = loader::validate_and_parse_template(&raw).unwrap();

        assert_eq!(parsed.name, "Ata");
        assert_eq!(parsed.sections.len(), 1);
    }

    #[test]
    fn save_avoids_ids_already_used_by_other_templates() {
        let dir = tempdir().unwrap();

        let id = save_in_dir(dir.path(), None, &sample_template("Standard"), |c| {
            c == "custom_standard"
        })
        .unwrap();

        assert_eq!(id, "custom_standard_2");
    }

    #[test]
    fn save_does_not_overwrite_an_existing_custom_file_when_creating() {
        let dir = tempdir().unwrap();
        let first = save_in_dir(dir.path(), None, &sample_template("Ata"), nothing_taken).unwrap();

        let second = save_in_dir(dir.path(), None, &sample_template("Ata"), nothing_taken).unwrap();

        assert_ne!(first, second);
    }

    #[test]
    fn save_with_existing_id_overwrites_that_template() {
        let dir = tempdir().unwrap();
        let id = save_in_dir(dir.path(), None, &sample_template("Ata"), nothing_taken).unwrap();

        let updated = save_in_dir(
            dir.path(),
            Some(&id),
            &sample_template("Ata Renomeada"),
            nothing_taken,
        )
        .unwrap();

        let raw = fs::read_to_string(dir.path().join(format!("{id}.json"))).unwrap();
        assert_eq!(updated, id);
        assert!(raw.contains("Ata Renomeada"));
    }

    #[test]
    fn save_with_unknown_id_is_rejected_instead_of_creating_a_file() {
        let dir = tempdir().unwrap();

        let result = save_in_dir(
            dir.path(),
            Some("daily_standup"),
            &sample_template("Ata"),
            nothing_taken,
        );

        assert!(result.is_err());
        assert!(!dir.path().join("daily_standup.json").exists());
    }

    #[test]
    fn save_rejects_invalid_templates_without_touching_disk() {
        let dir = tempdir().unwrap();
        let mut template = sample_template("Ata");
        template.sections.clear();

        let result = save_in_dir(dir.path(), None, &template, nothing_taken);

        assert!(result.is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn save_leaves_no_temp_files_behind() {
        let dir = tempdir().unwrap();
        save_in_dir(dir.path(), None, &sample_template("Ata"), nothing_taken).unwrap();

        let leftovers = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();

        assert_eq!(leftovers, 0);
    }

    #[test]
    fn delete_removes_the_custom_template() {
        let dir = tempdir().unwrap();
        let id = save_in_dir(dir.path(), None, &sample_template("Ata"), nothing_taken).unwrap();

        delete_in_dir(dir.path(), &id).unwrap();

        assert!(!is_custom_in_dir(dir.path(), &id));
    }

    #[test]
    fn delete_rejects_unknown_and_unsafe_ids() {
        let dir = tempdir().unwrap();
        let outside = dir.path().join("outside.json");
        fs::write(&outside, "{}").unwrap();
        let nested = dir.path().join("templates");
        fs::create_dir_all(&nested).unwrap();

        assert!(delete_in_dir(&nested, "missing").is_err());
        assert!(delete_in_dir(&nested, "../outside").is_err());
        assert!(outside.exists());
    }
}
