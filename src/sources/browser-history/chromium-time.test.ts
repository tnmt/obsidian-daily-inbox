import { describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import { chromiumMicrosFromDate, chromiumRangeForLocalDate, chromiumTimestampToDate } from "./chromium-time";

describe("chromiumMicrosFromDate / chromiumTimestampToDate", () => {
  it("round-trips a Date through Chromium microseconds", () => {
    const date = new Date("2026-09-23T12:34:56.000Z");
    const micros = chromiumMicrosFromDate(date);
    expect(chromiumTimestampToDate(micros).getTime()).toBe(date.getTime());
  });
});

describe("chromiumRangeForLocalDate", () => {
  it("buckets a visit just before local midnight into the given day", () => {
    const range = chromiumRangeForLocalDate(localDate("2026-09-23"));
    const justBeforeMidnight = new Date(2026, 8, 23, 23, 59, 59, 999);
    const micros = chromiumMicrosFromDate(justBeforeMidnight);
    expect(micros).toBeGreaterThanOrEqual(range.startMicros);
    expect(micros).toBeLessThan(range.endMicrosExclusive);
  });

  it("excludes a visit exactly at the next local midnight (high end is exclusive)", () => {
    const range = chromiumRangeForLocalDate(localDate("2026-09-23"));
    const nextMidnight = new Date(2026, 8, 24, 0, 0, 0, 0);
    const micros = chromiumMicrosFromDate(nextMidnight);
    expect(micros).toBe(range.endMicrosExclusive);
  });

  it("includes a visit exactly at local midnight (low end is inclusive)", () => {
    const range = chromiumRangeForLocalDate(localDate("2026-09-23"));
    const midnight = new Date(2026, 8, 23, 0, 0, 0, 0);
    expect(chromiumMicrosFromDate(midnight)).toBe(range.startMicros);
  });

  it("rolls over month/year boundaries correctly", () => {
    const range = chromiumRangeForLocalDate(localDate("2026-12-31"));
    const nextMidnight = new Date(2027, 0, 1, 0, 0, 0, 0);
    expect(chromiumMicrosFromDate(nextMidnight)).toBe(range.endMicrosExclusive);
  });
});
