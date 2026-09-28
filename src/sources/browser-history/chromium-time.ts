import type { LocalDate } from "../../domain";

// Chromium visit_time values are microseconds since 1601-01-01 00:00:00 UTC
// (the Windows FILETIME epoch), not the Unix epoch. This is the number of
// microseconds between the two epochs.
const CHROMIUM_UNIX_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000;

export function chromiumMicrosFromDate(date: Date): number {
  return date.getTime() * 1000 + CHROMIUM_UNIX_EPOCH_OFFSET_MICROS;
}

export function chromiumTimestampToDate(chromiumMicroseconds: number): Date {
  return new Date((chromiumMicroseconds - CHROMIUM_UNIX_EPOCH_OFFSET_MICROS) / 1000);
}

export interface ChromiumDateRange {
  /** Local midnight of the given date, inclusive. */
  readonly startMicros: number;
  /** Local midnight of the following date, exclusive. */
  readonly endMicrosExclusive: number;
}

export function chromiumRangeForLocalDate(date: LocalDate): ChromiumDateRange {
  const [year, month, day] = date.split("-").map(Number);
  // The Date constructor rolls month/day overflow into the next month/year,
  // so day + 1 correctly handles month- and year-end boundaries.
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  return {
    startMicros: chromiumMicrosFromDate(start),
    endMicrosExclusive: chromiumMicrosFromDate(end),
  };
}
