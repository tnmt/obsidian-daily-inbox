import type { LocalDate } from "../../domain";

export interface DayBounds {
  /** First instant of the local calendar day. */
  readonly start: Date;
  /** Last whole second of the local calendar day (search qualifiers are second-granular and inclusive). */
  readonly end: Date;
}

export function localDayBounds(date: LocalDate): DayBounds {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const nextStart = new Date(year, month - 1, day + 1);
  return { start, end: new Date(nextStart.getTime() - 1000) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 8601 local date-time with this machine's UTC offset at that instant, e.g. `2026-10-09T00:00:00+09:00`. */
function formatWithOffset(d: Date): string {
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Value for a GitHub search date qualifier (`author-date:`, `created:`, `closed:`) covering exactly the local day. */
export function searchDateRange(date: LocalDate): string {
  const { start, end } = localDayBounds(date);
  return `${formatWithOffset(start)}..${formatWithOffset(end)}`;
}

export function isWithin(instant: Date, bounds: DayBounds): boolean {
  return instant.getTime() >= bounds.start.getTime() && instant.getTime() <= bounds.end.getTime();
}
