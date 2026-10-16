use serde::{Deserialize, Serialize};

/// Limits keep user-authored templates from bloating the LLM prompt.
pub const MAX_NAME_CHARS: usize = 80;
pub const MAX_DESCRIPTION_CHARS: usize = 300;
pub const MAX_SECTIONS: usize = 30;
pub const MAX_SECTION_TITLE_CHARS: usize = 100;
pub const MAX_INSTRUCTION_CHARS: usize = 2000;
pub const MAX_ITEM_FORMAT_CHARS: usize = 1000;
/// Cap on all section text combined (~7k tokens): keeps local models' context usable.
pub const MAX_TOTAL_CHARS: usize = 20_000;

fn exceeds(value: &str, max_chars: usize) -> bool {
    value.chars().count() > max_chars
}

fn trimmed_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// Represents a single section in a meeting template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSection {
    /// Section title (e.g., "Summary", "Action Items")
    pub title: String,

    /// Instruction for the LLM on what to extract/include
    pub instruction: String,

    /// Format type: "paragraph", "list", or "string"
    pub format: String,

    /// Optional markdown formatting hint for list items (e.g., table structure)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_format: Option<String>,

    /// Alternative formatting hint
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub example_item_format: Option<String>,
}

/// Represents a complete meeting template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    /// Template display name
    pub name: String,

    /// Brief description of the template's purpose
    pub description: String,

    /// List of sections in the template
    pub sections: Vec<TemplateSection>,
}

impl Template {
    /// Returns a copy with surrounding whitespace removed and blank optional
    /// formats dropped, so UI input is stored in canonical form.
    pub fn normalized(&self) -> Template {
        Template {
            name: self.name.trim().to_string(),
            description: self.description.trim().to_string(),
            sections: self
                .sections
                .iter()
                .map(|section| TemplateSection {
                    title: section.title.trim().to_string(),
                    instruction: section.instruction.trim().to_string(),
                    format: section.format.trim().to_string(),
                    item_format: trimmed_non_empty(section.item_format.as_deref()),
                    example_item_format: trimmed_non_empty(section.example_item_format.as_deref()),
                })
                .collect(),
        }
    }

    /// Validates the template structure.
    ///
    /// This is the check applied when *loading* a template, so it is kept
    /// lenient about size: hand-written files that predate the size limits
    /// must keep working. New and edited templates go through
    /// [`Template::validate_for_save`].
    pub fn validate(&self) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("O nome do modelo não pode ficar vazio".to_string());
        }

        if self.description.trim().is_empty() {
            return Err("A descrição do modelo não pode ficar vazia".to_string());
        }

        if self.sections.is_empty() {
            return Err("O modelo precisa ter pelo menos uma seção".to_string());
        }

        for (i, section) in self.sections.iter().enumerate() {
            if section.title.trim().is_empty() {
                return Err(format!("A seção {} tem título vazio", i + 1));
            }

            if section.instruction.trim().is_empty() {
                return Err(format!("A seção '{}' tem instrução vazia", section.title));
            }

            match section.format.as_str() {
                "paragraph" | "list" | "string" => {},
                other => return Err(format!(
                    "A seção '{}' tem formato inválido '{}'. Deve ser 'paragraph', 'list' ou 'string'",
                    section.title, other
                )),
            }
        }

        Ok(())
    }

    /// Structural validation plus the size limits enforced on templates
    /// created or edited from the UI (they all end up in the LLM prompt).
    pub fn validate_for_save(&self) -> Result<(), String> {
        self.validate()?;

        if exceeds(&self.name, MAX_NAME_CHARS) {
            return Err(format!(
                "O nome do modelo deve ter no máximo {} caracteres",
                MAX_NAME_CHARS
            ));
        }
        if exceeds(&self.description, MAX_DESCRIPTION_CHARS) {
            return Err(format!(
                "A descrição do modelo deve ter no máximo {} caracteres",
                MAX_DESCRIPTION_CHARS
            ));
        }
        if self.sections.len() > MAX_SECTIONS {
            return Err(format!("O modelo pode ter no máximo {} seções", MAX_SECTIONS));
        }

        for section in &self.sections {
            if exceeds(&section.title, MAX_SECTION_TITLE_CHARS) {
                return Err(format!(
                    "O título da seção '{}' deve ter no máximo {} caracteres",
                    section.title, MAX_SECTION_TITLE_CHARS
                ));
            }
            if exceeds(&section.instruction, MAX_INSTRUCTION_CHARS) {
                return Err(format!(
                    "A instrução da seção '{}' deve ter no máximo {} caracteres",
                    section.title, MAX_INSTRUCTION_CHARS
                ));
            }

            let item_format_too_long = [&section.item_format, &section.example_item_format]
                .into_iter()
                .filter_map(|f| f.as_deref())
                .any(|f| exceeds(f, MAX_ITEM_FORMAT_CHARS));
            if item_format_too_long {
                return Err(format!(
                    "O formato dos itens da seção '{}' deve ter no máximo {} caracteres",
                    section.title, MAX_ITEM_FORMAT_CHARS
                ));
            }
        }

        if self.prompt_chars() > MAX_TOTAL_CHARS {
            return Err(format!(
                "O modelo é grande demais: use no máximo {} caracteres somando todas as seções",
                MAX_TOTAL_CHARS
            ));
        }

        Ok(())
    }

    /// Characters the sections contribute to the LLM prompt.
    fn prompt_chars(&self) -> usize {
        self.sections
            .iter()
            .map(|section| {
                section.title.chars().count()
                    + section.instruction.chars().count()
                    + [&section.item_format, &section.example_item_format]
                        .into_iter()
                        .flatten()
                        .map(|f| f.chars().count())
                        .sum::<usize>()
            })
            .sum()
    }

    /// Generates a clean markdown template structure
    pub fn to_markdown_structure(&self) -> String {
        let mut markdown = String::from("# <Add Title here>\n\n");

        for section in &self.sections {
            markdown.push_str(&format!("**{}**\n\n", section.title));
        }

        markdown
    }

    /// Generates section-specific instructions for the LLM
    pub fn to_section_instructions(&self) -> String {
        let mut instructions = String::from(
            "- **For the main title (`# [AI-Generated Title]`):** Analyze the entire transcript and create a concise, descriptive title for the meeting.\n"
        );

        for section in &self.sections {
            instructions.push_str(&format!(
                "- **For the '{}' section:** {}.\n",
                section.title, section.instruction
            ));

            // Add item format instructions if present
            let item_format = section.item_format.as_ref()
                .or(section.example_item_format.as_ref());

            if let Some(format) = item_format {
                instructions.push_str(&format!(
                    "  - Items in this section should follow the format: `{}`.\n",
                    format
                ));
            }
        }

        instructions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn section(title: &str, instruction: &str, format: &str) -> TemplateSection {
        TemplateSection {
            title: title.to_string(),
            instruction: instruction.to_string(),
            format: format.to_string(),
            item_format: None,
            example_item_format: None,
        }
    }

    fn template_with(sections: Vec<TemplateSection>) -> Template {
        Template {
            name: "Modelo".to_string(),
            description: "Descrição".to_string(),
            sections,
        }
    }

    #[test]
    fn test_validate_valid_template() {
        let template = template_with(vec![section("Summary", "Provide a summary", "paragraph")]);

        assert!(template.validate().is_ok());
    }

    #[test]
    fn test_validate_empty_name() {
        let template = Template {
            name: "".to_string(),
            description: "A test template".to_string(),
            sections: vec![],
        };

        assert!(template.validate().is_err());
    }

    #[test]
    fn test_validate_invalid_format() {
        let template = template_with(vec![section("Test", "Test", "invalid")]);

        assert!(template.validate().is_err());
    }

    #[test]
    fn rejects_whitespace_only_name() {
        let mut template = template_with(vec![section("Resumo", "Resuma", "paragraph")]);
        template.name = "   ".to_string();

        assert!(template.validate().is_err());
    }

    #[test]
    fn rejects_whitespace_only_section_instruction() {
        let template = template_with(vec![section("Resumo", "  \n ", "paragraph")]);

        assert!(template.validate().is_err());
    }

    #[test]
    fn rejects_too_many_sections_on_save() {
        let sections = (0..=MAX_SECTIONS)
            .map(|i| section(&format!("Seção {i}"), "Instrução", "paragraph"))
            .collect();

        assert!(template_with(sections).validate_for_save().is_err());
    }

    #[test]
    fn rejects_oversized_instruction_on_save() {
        let long = "a".repeat(MAX_INSTRUCTION_CHARS + 1);
        let template = template_with(vec![section("Resumo", &long, "paragraph")]);

        assert!(template.validate_for_save().is_err());
    }

    #[test]
    fn rejects_templates_whose_combined_text_is_too_large() {
        let sections = (0..MAX_SECTIONS)
            .map(|i| section(&format!("S{i}"), &"a".repeat(MAX_INSTRUCTION_CHARS), "paragraph"))
            .collect();

        assert!(template_with(sections).validate_for_save().is_err());
    }

    #[test]
    fn loading_stays_lenient_about_size() {
        let long = "a".repeat(MAX_INSTRUCTION_CHARS + 1);
        let mut template = template_with(vec![section("Resumo", &long, "paragraph")]);
        template.description = "d".repeat(MAX_DESCRIPTION_CHARS + 1);

        assert!(template.validate().is_ok());
    }

    #[test]
    fn counts_characters_not_bytes_for_limits() {
        let accented = "ã".repeat(MAX_SECTION_TITLE_CHARS);
        let template = template_with(vec![section(&accented, "Instrução", "paragraph")]);

        assert!(template.validate_for_save().is_ok());
    }

    #[test]
    fn normalized_trims_text_and_drops_blank_item_formats() {
        let template = Template {
            name: "  Modelo  ".to_string(),
            description: " Desc ".to_string(),
            sections: vec![TemplateSection {
                title: " Resumo ".to_string(),
                instruction: " Resuma ".to_string(),
                format: "list".to_string(),
                item_format: Some("   ".to_string()),
                example_item_format: Some(" | a | ".to_string()),
            }],
        };

        let normalized = template.normalized();

        assert_eq!(normalized.name, "Modelo");
        assert_eq!(normalized.description, "Desc");
        assert_eq!(normalized.sections[0].title, "Resumo");
        assert_eq!(normalized.sections[0].instruction, "Resuma");
        assert_eq!(normalized.sections[0].item_format, None);
        assert_eq!(
            normalized.sections[0].example_item_format.as_deref(),
            Some("| a |")
        );
    }
}
