import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import { isWithin, localDayBounds, searchDateRange } from "./date-range";

describe("date range in a fixed zone", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("covers exactly the local calendar day with the local UTC offset", () => {
    expect(searchDateRange(localDate("2026-10-09"))).toBe("2026-10-09T00:00:00+09:00..2026-10-09T23:59:59+09:00");
  });

  it("keeps activity just after local midnight on the later date", () => {
    // 2026-10-08T15:30:00Z is 00:30 on 10-09 in Tokyo.
    const instant = new Date("2026-10-08T15:30:00Z");
    expect(isWithin(instant, localDayBounds(localDate("2026-10-09")))).toBe(true);
    expect(isWithin(instant, localDayBounds(localDate("2026-10-08")))).toBe(false);
  });

  it("includes the last second of the day and excludes the next midnight", () => {
    const bounds = localDayBounds(localDate("2026-10-09"));
    expect(isWithin(new Date("2026-10-09T14:59:59Z"), bounds)).toBe(true);
    expect(isWithin(new Date("2026-10-09T15:00:00Z"), bounds)).toBe(false);
  });
});

describe("date range across a UTC-offset change", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("uses the offset in effect at each end of the day", () => {
    // US DST ended 2026-11-01: midnight is -04:00, the end of the day is -05:00.
    expect(searchDateRange(localDate("2026-11-01"))).toBe("2026-11-01T00:00:00-04:00..2026-11-01T23:59:59-05:00");
  });
});
