export const MIN_SELECTION_CHARS = 3;
export const MAX_SELECTION_CHARS = 600;
export const MAX_ASK_CONTEXT_CHARS = 3000;

/**
 * Cleans text selected in the UI so it can be sent as a question: collapses all
 * whitespace and returns null when it is too short (stray clicks, single
 * letters) or too long to be a phrase worth searching.
 */
export function normalizeSelection(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < MIN_SELECTION_CHARS || text.length > MAX_SELECTION_CHARS) return null;

  return text;
}

/**
 * Joins the pieces of meeting context sent along with a question. When it does
 * not fit, the end is kept (the most recent speech matters most), cut at a word
 * boundary.
 */
export function buildAskContext(
  parts: Array<string | null | undefined>,
  maxChars: number = MAX_ASK_CONTEXT_CHARS
): string {
  const joined = parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');

  if (joined.length <= maxChars) return joined;

  const tail = joined.slice(joined.length - maxChars);
  const firstSpace = tail.search(/\s/);
  // Drop the (probably cut) first word, unless that would throw the tail away.
  return firstSpace > 0 && firstSpace < maxChars / 2 ? tail.slice(firstSpace).trim() : tail.trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Picks the part of a long text around the first mention of `term`, so a question about
 * a keyword is sent with the passage that talks about it instead of the end of the
 * meeting. Falls back to the end of the text when the term is not found.
 */
export function windowAroundTerm(
  text: string,
  term: string,
  maxChars: number = MAX_ASK_CONTEXT_CHARS
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const needle = term.trim();
  const index = needle ? trimmed.search(new RegExp(escapeRegExp(needle), 'i')) : -1;
  if (index < 0) return buildAskContext([trimmed], maxChars);

  const start = Math.min(
    Math.max(0, index - Math.floor((maxChars - needle.length) / 2)),
    trimmed.length - maxChars
  );
  let slice = trimmed.slice(start, start + maxChars);

  // Do not start or end in the middle of a word (unless that is the very beginning/end).
  if (start > 0) slice = slice.replace(/^\S*\s+/, '');
  if (start + maxChars < trimmed.length) slice = slice.replace(/\s+\S*$/, '');
  return slice.trim();
}

const BUTTON_HALF_WIDTH = 70;
const BUTTON_HEIGHT = 36;
const EDGE_MARGIN = 8;

export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * Where to put the floating "ask" button (center-x and top, in viewport
 * coordinates): above the selection, or below it when there is no room above,
 * and always inside the viewport.
 */
export function computeButtonPosition(
  rect: SelectionRect,
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const centerX = rect.left + rect.width / 2;
  const left = Math.min(
    Math.max(centerX, BUTTON_HALF_WIDTH + EDGE_MARGIN),
    viewport.width - BUTTON_HALF_WIDTH - EDGE_MARGIN
  );

  const above = rect.top - BUTTON_HEIGHT - EDGE_MARGIN;
  const top = above >= EDGE_MARGIN ? above : rect.bottom + EDGE_MARGIN;

  return { left, top: Math.min(top, viewport.height - BUTTON_HEIGHT - EDGE_MARGIN) };
}
