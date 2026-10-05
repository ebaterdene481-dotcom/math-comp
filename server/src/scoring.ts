// Scores are kept as integer hundredths of a point (10000 = 100.00)
// so no floating-point rounding ever reaches the leaderboard.

export const TIME_LIMIT_MS = 5000;
/** Answers at or below this time get full points; a bot gains nothing by being faster. */
export const FULL_POINTS_MS = 500;
export const MAX_POINTS_HUNDREDTHS = 10000;

export function scoreHundredths(elapsedMs: number): number {
  if (elapsedMs <= FULL_POINTS_MS) return MAX_POINTS_HUNDREDTHS;
  if (elapsedMs >= TIME_LIMIT_MS) return 0;
  return Math.round(
    (MAX_POINTS_HUNDREDTHS * (TIME_LIMIT_MS - elapsedMs)) / (TIME_LIMIT_MS - FULL_POINTS_MS),
  );
}

/** Parses a typed answer. Accepts digits with surrounding spaces and leading zeros only. */
export function parseAnswer(raw: string): number | null {
  const s = raw.replace(/\s+/g, "");
  if (!/^\d{1,6}$/.test(s)) return null;
  return Number.parseInt(s, 10);
}
