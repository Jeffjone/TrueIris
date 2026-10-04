/** Calendar boundaries in an IANA timezone, including 23/25-hour days. */
export function dateKey(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(time);
  return ['year', 'month', 'day']
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join('-');
}
export function dayRange(date: string, timezone: string) {
  const anchor = Date.parse(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(anchor) ||
    new Date(anchor).toISOString().slice(0, 10) !== date
  )
    throw new Error('Invalid date');
  const boundary = (after: boolean) => {
    let low = anchor - 36 * 3600_000,
      high = anchor + 60 * 3600_000;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2),
        key = dateKey(mid, timezone);
      if (after ? key <= date : key < date) low = mid;
      else high = mid;
    }
    return new Date(high).toISOString();
  };
  return { start: boundary(false), end: boundary(true) };
}
