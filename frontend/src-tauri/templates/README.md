# Meeting Summary Templates

This directory contains template definitions for meeting summary generation.

## Available Templates

### 1. `daily_standup.json`
Time-boxed daily updates template designed for engineering/product teams.

**Sections:**
- Attendees
- Yesterday (completed work)
- Today (planned work)
- Blockers
- Notes

### 2. `standard_meeting.json`
General-purpose meeting notes template focusing on key outcomes and actions.

**Sections:**
- Summary
- Key Decisions
- Action Items
- Discussion Highlights

## Template Structure

Each template JSON file follows this schema:

```json
{
  "name": "Template Name",
  "description": "Brief description of the template's purpose",
  "sections": [
    {
      "title": "Section Title",
      "instruction": "Instructions for the LLM on what to extract/include",
      "format": "paragraph|list|string",
      "item_format": "Optional: Markdown table format for list items"
    }
  ]
}
```

## Custom Templates

Users create, edit, duplicate and delete custom templates in the app
(**Configurações > Resumo > Modelos de Resumo**, or **Modelo > Gerenciar modelos** on
the meeting screen). Built-in templates are read-only but can be duplicated.

Each custom template is saved as `<id>.json` in the application data directory
(ids created by the app look like `custom_ata_de_diretoria`):

- **macOS**: `~/Library/Application Support/Meetily/templates/`
- **Windows**: `%APPDATA%\Meetily\templates\`
- **Linux**: `~/.config/Meetily/templates/`

Files dropped there by hand also work and override built-in templates with the same
filename. Template ids (the file name without `.json`) may only contain letters, digits,
spaces and `_ - . ( ) @ +`; other files are ignored.

Limits enforced when saving from the app: name 80 characters, description 300, up to 30
sections, section title 100, instruction 2000, item format 1000, and 20,000 characters of
section text combined. Files loaded from disk are only checked structurally, so existing
hand-written templates keep working even if they exceed these limits.

## Meeting Date

Every generated summary starts with a `**Data:** 16 de outubro de 2026` line right below the
title, added by the app after generation (see `summary/meeting_date.rs`). Templates do not need
a "Date" section for this.

## Template Fields

### Root Level
- `name` (required): Display name for the template
- `description` (required): Brief explanation of the template's use case
- `sections` (required): Array of section definitions

### Section Object
- `title` (required): Section heading text
- `instruction` (required): LLM guidance for this section
- `format` (required): One of `"paragraph"`, `"list"`, or `"string"`
- `item_format` (optional): Markdown formatting hint for list items (e.g., table structure)
- `example_item_format` (optional): Alternative formatting hint

## Usage in Code

Templates are loaded using the `templates` module:

```rust
use crate::summary::templates;

// Get a specific template
let template = templates::get_template("daily_standup")?;

// List available templates
let available = templates::list_templates();

// Validate custom template JSON
let custom_json = std::fs::read_to_string("custom.json")?;
let validated = templates::validate_template(&custom_json)?;
```
