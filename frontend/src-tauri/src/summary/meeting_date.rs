//! Stamps the meeting date on generated summaries ("atas").
//!
//! The date is added deterministically after generation instead of being
//! requested from the LLM, so every summary carries it regardless of the
//! template, model or language in use.

use chrono::{DateTime, Datelike, TimeZone};

const MONTHS_PT_BR: [&str; 12] = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
];

const DATE_LABEL: &str = "**Data:**";

/// Formats a date the way Brazilian minutes write it: `16 de outubro de 2026`
/// (`1º de janeiro de 2027` for the first day of the month).
pub fn format_date_pt_br<Tz: TimeZone>(date: &DateTime<Tz>) -> String {
    let day = match date.day() {
        1 => "1º".to_string(),
        other => other.to_string(),
    };

    format!(
        "{day} de {} de {}",
        MONTHS_PT_BR[date.month0() as usize],
        date.year()
    )
}

/// Inserts a `**Data:** <date>` line right below the leading `# Title`
/// (or at the very top when the markdown has no leading title).
///
/// The title is kept in place on purpose: callers extract the meeting name
/// from it and strip it afterwards, leaving the date as the first line of the
/// stored summary body.
pub fn insert_meeting_date<Tz: TimeZone>(markdown: &str, date: &DateTime<Tz>) -> String {
    let date_line = format!("{DATE_LABEL} {}", format_date_pt_br(date));
    let trimmed = markdown.trim_start();

    if !trimmed.starts_with("# ") {
        return if trimmed.is_empty() {
            date_line
        } else {
            format!("{date_line}\n\n{trimmed}")
        };
    }

    let (title, body) = match trimmed.split_once('\n') {
        Some((title, rest)) => (title, rest.trim_start()),
        None => (trimmed, ""),
    };

    if body.is_empty() {
        format!("{title}\n\n{date_line}")
    } else {
        format!("{title}\n\n{date_line}\n\n{body}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn date(year: i32, month: u32, day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, 12, 0, 0).unwrap()
    }

    #[test]
    fn formats_long_portuguese_date() {
        assert_eq!(format_date_pt_br(&date(2026, 10, 16)), "16 de outubro de 2026");
    }

    #[test]
    fn uses_ordinal_for_the_first_day_of_the_month() {
        assert_eq!(format_date_pt_br(&date(2027, 1, 1)), "1º de janeiro de 2027");
    }

    #[test]
    fn does_not_zero_pad_other_single_digit_days() {
        assert_eq!(format_date_pt_br(&date(2026, 3, 5)), "5 de março de 2026");
    }

    #[test]
    fn inserts_date_below_the_title() {
        let result = insert_meeting_date("# Reunião\n\n## Resumo\nTexto", &date(2026, 10, 16));

        assert_eq!(
            result,
            "# Reunião\n\n**Data:** 16 de outubro de 2026\n\n## Resumo\nTexto"
        );
    }

    #[test]
    fn inserts_date_at_the_top_when_there_is_no_title() {
        let result = insert_meeting_date("## Resumo\nTexto", &date(2026, 10, 16));

        assert_eq!(result, "**Data:** 16 de outubro de 2026\n\n## Resumo\nTexto");
    }

    #[test]
    fn handles_a_title_with_no_body() {
        let result = insert_meeting_date("# Reunião", &date(2026, 10, 16));

        assert_eq!(result, "# Reunião\n\n**Data:** 16 de outubro de 2026");
    }

    #[test]
    fn handles_empty_markdown() {
        let result = insert_meeting_date("  \n", &date(2026, 10, 16));

        assert_eq!(result, "**Data:** 16 de outubro de 2026");
    }

    #[test]
    fn ignores_leading_blank_lines_before_the_title() {
        let result = insert_meeting_date("\n\n# Reunião\n## Resumo", &date(2026, 10, 16));

        assert!(result.starts_with("# Reunião\n\n**Data:**"));
    }
}
