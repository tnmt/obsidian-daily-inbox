import { describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import { expandFolderPathTemplate, resolveConfiguredFolderPaths } from "./folder-path-template";

describe("expandFolderPathTemplate", () => {
  it("substitutes {year} with the date's local 4-digit year", () => {
    expect(expandFolderPathTemplate("/Pictures/Archive/{year}", localDate("2025-01-15"))).toBe(
      "/Pictures/Archive/2025",
    );
  });

  it("leaves a template with no placeholder unchanged", () => {
    expect(expandFolderPathTemplate("/Camera Uploads", localDate("2025-01-15"))).toBe("/Camera Uploads");
  });

  it("substitutes every occurrence of the placeholder", () => {
    expect(expandFolderPathTemplate("/{year}/backup/{year}", localDate("2025-01-15"))).toBe(
      "/2025/backup/2025",
    );
  });
});

describe("resolveConfiguredFolderPaths", () => {
  it("trims, expands, and preserves configuration order", () => {
    expect(
      resolveConfiguredFolderPaths([" /Camera Uploads ", "/Pictures/Archive/{year}"], localDate("2025-06-01")),
    ).toEqual(["/Camera Uploads", "/Pictures/Archive/2025"]);
  });

  it("drops blank entries", () => {
    expect(resolveConfiguredFolderPaths(["/Camera Uploads", "  ", ""], localDate("2025-06-01"))).toEqual([
      "/Camera Uploads",
    ]);
  });

  it("dedupes paths that resolve to the same string", () => {
    expect(
      resolveConfiguredFolderPaths(["/Photos/{year}", "/Photos/{year}"], localDate("2025-06-01")),
    ).toEqual(["/Photos/2025"]);
  });

  it("dedupes paths that differ only by case, keeping the first casing seen", () => {
    expect(
      resolveConfiguredFolderPaths(["/Camera Uploads", "/camera uploads"], localDate("2025-06-01")),
    ).toEqual(["/Camera Uploads"]);
  });

  it("returns an empty list when nothing is configured", () => {
    expect(resolveConfiguredFolderPaths([], localDate("2025-06-01"))).toEqual([]);
  });
});
