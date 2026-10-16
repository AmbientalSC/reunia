/** How many of the latest segments feed one insight. */
export const INSIGHT_EXCERPT_SEGMENTS = 40;

/** The text sent to the AI for a live insight: the latest segments, one per line. */
export function buildInsightExcerpt(segments: Array<{ text: string }>): string {
  return segments
    .slice(-INSIGHT_EXCERPT_SEGMENTS)
    .map((segment) => segment.text)
    .filter(Boolean)
    .join('\n');
}
