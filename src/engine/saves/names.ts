/** Build names: they're file names (layouts/<name>.yaml) and storage keys, so only safe characters. */
export const BUILD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
export const BUILD_NAME_RULE = 'letters, digits, spaces, _ and - (up to 64, starting with a letter or digit)';

/** A safe build name from any text ("Trixie: anti-Raven!" → "Trixie_ anti-Raven_"); '' if nothing usable. */
export function safeBuildName(text: string): string {
  return text
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, '_')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
    .trim();
}
