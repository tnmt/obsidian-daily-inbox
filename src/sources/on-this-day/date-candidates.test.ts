import { describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import { sameDateCandidates } from "./date-candidates";

describe("sameDateCandidates", () => {
  it("returns past years nearest first, then future years nearest first", () => {
    const files = [
      "2019-09-28.md",
      "2021-09-28.md",
      "2023-09-28.md",
      "2025-09-28.md",
      "2026-09-28.md",
      "2022-09-28.md",
    ];
    expect(sameDateCandidates(localDate("2022-09-28"), files)).toEqual([
      { year: 2021, offset: -1, fileName: "2021-09-28.md" },
      { year: 2019, offset: -3, fileName: "2019-09-28.md" },
      { year: 2023, offset: 1, fileName: "2023-09-28.md" },
      { year: 2025, offset: 3, fileName: "2025-09-28.md" },
      { year: 2026, offset: 4, fileName: "2026-09-28.md" },
    ]);
  });

  it("ignores files whose month/day differ or whose name isn't a daily-note pattern", () => {
    const files = [
      "2025-09-27.md",
      "2025-09-28.md",
      "2024-10-28.md",
      "notes/2024-09-28-summary.md",
      "random.md",
    ];
    expect(sameDateCandidates(localDate("2026-09-28"), files)).toEqual([
      { year: 2025, offset: -1, fileName: "2025-09-28.md" },
    ]);
  });

  it("collapses duplicate filenames from different folders into one candidate", () => {
    expect(sameDateCandidates(localDate("2026-09-28"), ["2025-09-28.md", "2025-09-28.md"])).toEqual([
      { year: 2025, offset: -1, fileName: "2025-09-28.md" },
    ]);
  });

  it("excludes the context date's own year", () => {
    expect(sameDateCandidates(localDate("2026-09-28"), ["2026-09-28.md"])).toEqual([]);
  });

  it("returns nothing when no candidate matches", () => {
    expect(sameDateCandidates(localDate("2026-09-28"), [])).toEqual([]);
  });
});
