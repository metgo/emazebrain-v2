/** Small, pure helpers for display. Unit-tested in test/format.test.ts. */

/** Whole years and months between a date of birth (YYYY-MM-DD) and today. */
export function ageParts(dob: string, today: Date = new Date()): { years: number; months: number } {
  const [y, m, d] = dob.slice(0, 10).split("-").map(Number) as [number, number, number];
  let months = (today.getFullYear() - y) * 12 + (today.getMonth() + 1 - m);
  if (today.getDate() < d) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months };
}

/** Parse YYYY-MM-DD as a calendar date (no time-zone shift). */
export function calendarDate(dob: string): Date {
  const [y, m, d] = dob.slice(0, 10).split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/**
 * Search key: case-folded, Hebrew points and cantillation and Arabic harakat
 * removed, so "נֹעָה" finds "נועה" (design doc §4.3).
 */
export function searchKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[֑-ׇؐ-ًؚ-ٰٟۖ-ۭ̀-ͯ]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function matchesQuery(fields: string[], query: string): boolean {
  const terms = searchKey(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = fields.map(searchKey);
  return terms.every((t) => hay.some((h) => h.split(/\s+/).some((w) => w.startsWith(t)) || h.startsWith(t)));
}

export function dayPart(now: Date = new Date()): "morning" | "afternoon" | "evening" {
  const h = now.getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Wraps a name in Unicode isolates so a Hebrew name in an English sentence (or the reverse) keeps its place. */
export function iso(text: string): string {
  return `\u2068${text}\u2069`;
}
