import { describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import { pastYearCandidates } from "./date-candidates";

describe("pastYearCandidates", () => {
  it("lists years back nearest first", () => {
    expect(pastYearCandidates(localDate("2026-09-27"), 3)).toEqual([
      { year: 2025, yearsAgo: 1, fileName: "2025-09-27.md" },
      { year: 2024, yearsAgo: 2, fileName: "2024-09-27.md" },
      { year: 2023, yearsAgo: 3, fileName: "2023-09-27.md" },
    ]);
  });

  it("skips Feb 29 in non-leap years without falling back to Feb 28", () => {
    // 2023, 2022, 2021 are not leap years; 2020 is.
    expect(pastYearCandidates(localDate("2024-02-29"), 4)).toEqual([
      { year: 2020, yearsAgo: 4, fileName: "2020-02-29.md" },
    ]);
  });

  it("returns an empty list for yearsBack = 0", () => {
    expect(pastYearCandidates(localDate("2026-09-27"), 0)).toEqual([]);
  });
});
