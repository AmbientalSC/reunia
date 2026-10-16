/**
 * Formats a meeting date the way Brazilian minutes write it: "16 de outubro de 2026"
 * ("1º de janeiro de 2027" for the first day). Mirrors the backend formatter
 * (summary/meeting_date.rs) so the stored summary and the UI/exports agree.
 *
 * Missing or invalid input falls back to today's date.
 */
export function formatMeetingDate(value?: string | number | Date | null): string {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  const day = date.getDate() === 1 ? '1º' : String(date.getDate());
  const monthAndYear = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return `${day} de ${monthAndYear}`;
}
