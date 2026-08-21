/**
 * Parses the --interval CLI option. Returns null for anything that is not a
 * number >= 1 (floats are floored) so it can never become a 0ms rapid-fire timer.
 */
export function parseIntervalMinutes(raw: string): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.floor(value);
}
