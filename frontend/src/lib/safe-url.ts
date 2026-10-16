const MAX_URL_CHARS = 2048;

/**
 * Parses `value` when it is an http(s) link that is safe to show as a link and open
 * in the browser: no other scheme (javascript:, file:, custom protocols), no
 * relative paths, no embedded credentials (`https://gov.br@evil.example`) and a
 * bounded length. AI answers and web results are untrusted, so anything else
 * must stay plain text.
 */
export function parseWebUrl(value: string | null | undefined): URL | null {
  if (!value || value.length > MAX_URL_CHARS) return null;

  try {
    const url = new URL(value);
    const isWeb = url.protocol === 'http:' || url.protocol === 'https:';
    return isWeb && url.hostname !== '' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function isWebUrl(value: string | null | undefined): value is string {
  return parseWebUrl(value) !== null;
}

/** The canonical form of a web URL (to compare two spellings of the same link), or null. */
export function normalizeWebUrl(value: string | null | undefined): string | null {
  return parseWebUrl(value)?.href ?? null;
}

/** The host to show next to a link, so its real destination is always visible. */
export function webHost(value: string | null | undefined): string | null {
  const host = parseWebUrl(value)?.hostname;
  return host ? host.replace(/^www\./, '') : null;
}
