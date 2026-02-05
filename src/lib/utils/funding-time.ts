/**
 * Compute time (ms) until the next funding event for a given interval.
 * Intervals: 1h (every hour), 2h (00,02,...,22), 4h (00,04,08,12,16,20), 8h (00,08,16).
 */
export function getTimeToNextFundingMs(interval: string): number {
  const now = new Date();
  const utcMs =
    now.getUTCHours() * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds();
  const dayMs = 24 * 3600000;

  const norm = (interval ?? '8h').toLowerCase();

  let nextBoundaryMs: number;

  if (norm === '1h') {
    const nextHour = Math.floor(utcMs / 3600000) + 1;
    nextBoundaryMs = nextHour * 3600000;
    if (nextHour >= 24) nextBoundaryMs = dayMs;
  } else if (norm === '2h') {
    const boundaries = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
    const next = boundaries.find((h) => h * 3600000 > utcMs);
    nextBoundaryMs = next != null ? next * 3600000 : dayMs;
  } else if (norm === '4h') {
    const boundaries = [0, 4, 8, 12, 16, 20];
    const next = boundaries.find((h) => h * 3600000 > utcMs);
    nextBoundaryMs = next != null ? next * 3600000 : dayMs;
  } else {
    const boundaries = [0, 8, 16];
    const next = boundaries.find((h) => h * 3600000 > utcMs);
    nextBoundaryMs = next != null ? next * 3600000 : dayMs;
  }

  let diff = nextBoundaryMs - utcMs;
  if (diff <= 0) diff += dayMs;
  return diff;
}
