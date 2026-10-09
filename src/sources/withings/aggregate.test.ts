import { describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import { buildSessions, localDayRange } from "./aggregate";
import type { MeasureGroup } from "./client";

const date = localDate("2026-09-30");
// 2026-09-30T07:12:00+09:00
const T0 = Date.UTC(2026, 8, 29, 22, 12) / 1000;

const group = (offsetSeconds: number, measures: Array<[number, number]>): MeasureGroup => ({
  date: T0 + offsetSeconds,
  measures: measures.map(([type, value]) => ({ type, value })),
});

describe("buildSessions", () => {
  it("merges groups of one weigh-in into a single session in display order", () => {
    const sessions = buildSessions(
      [
        group(0, [[1, 55.7], [6, 15.74], [76, 44.4], [8, 8.8]]),
        group(60, [[11, 62]]),
        group(120, [[91, 6.04], [155, 38]]),
      ],
      "Asia/Tokyo",
      date,
    );
    expect(sessions).toEqual([
      { startUnix: T0, time: "07:12", summary: "Weight 55.7kg / Fat 15.7% / Muscle 44.4kg / PWV 6.0m/s / HR 62bpm / Vascular age 38" },
    ]);
  });

  it("splits groups further apart than the session gap", () => {
    const sessions = buildSessions([group(0, [[1, 55.7]]), group(31 * 60, [[1, 56.1]])], "Asia/Tokyo", date);
    expect(sessions.map((s) => s.summary)).toEqual(["Weight 55.7kg", "Weight 56.1kg"]);
  });

  it("chains groups that are each within the gap of the previous one", () => {
    const sessions = buildSessions(
      [group(0, [[1, 55.7]]), group(25 * 60, [[11, 60]]), group(50 * 60, [[91, 6]])],
      "Asia/Tokyo",
      date,
    );
    expect(sessions).toHaveLength(1);
  });

  it("keeps the later value when a session repeats a type", () => {
    const sessions = buildSessions([group(0, [[1, 55.7]]), group(60, [[1, 55.9]])], "Asia/Tokyo", date);
    expect(sessions[0].summary).toBe("Weight 55.9kg");
  });

  it("places groups on the date of the account's time zone, not the machine's", () => {
    // 2026-09-29T22:12Z is already the 30th in Tokyo but still the 29th in UTC.
    expect(buildSessions([group(0, [[1, 55.7]])], "Asia/Tokyo", date)).toHaveLength(1);
    expect(buildSessions([group(0, [[1, 55.7]])], "UTC", date)).toHaveLength(0);
  });

  it("drops sessions that hold only types it does not display", () => {
    expect(buildSessions([group(0, [[77, 40]])], "Asia/Tokyo", date)).toEqual([]);
  });

  it("rejects an unknown time zone as malformed", () => {
    expect(() => buildSessions([group(0, [[1, 55.7]])], "Not/AZone", date)).toThrow(/time zone/);
  });
});

describe("localDayRange", () => {
  it("spans exactly the local calendar day", () => {
    const { startUnix, endUnix } = localDayRange(date);
    expect(new Date(startUnix * 1000).getHours()).toBe(0);
    expect(new Date(endUnix * 1000).getDate()).toBe(30);
    expect(new Date((endUnix + 1) * 1000).getDate()).toBe(1);
  });
});
