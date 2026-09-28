import { describe, expect, it } from "vitest";
import { migrateDropboxSettings } from "./settings";

describe("migrateDropboxSettings", () => {
  it("converts a legacy single folderPath into a one-entry folderPaths list", () => {
    expect(migrateDropboxSettings({ clientId: "key", folderPath: "/Camera Uploads" })).toEqual({
      clientId: "key",
      folderPaths: ["/Camera Uploads"],
    });
  });

  it("leaves data that already has folderPaths untouched", () => {
    const settings = { clientId: "key", folderPaths: ["/Camera Uploads", "/Archive/{year}"] };
    expect(migrateDropboxSettings(settings)).toEqual(settings);
  });

  it("passes through data with neither field unchanged", () => {
    expect(migrateDropboxSettings({ clientId: "key" })).toEqual({ clientId: "key" });
  });

  it("passes through nullish input unchanged", () => {
    expect(migrateDropboxSettings(undefined)).toBeUndefined();
  });

  it("drops a non-array folderPaths (e.g. corrupted by a sync conflict) so the default applies", () => {
    expect(migrateDropboxSettings({ clientId: "key", folderPaths: null })).toEqual({ clientId: "key" });
  });

  it("drops a folderPaths array containing non-string entries", () => {
    expect(migrateDropboxSettings({ clientId: "key", folderPaths: ["/ok", 42] })).toEqual({
      clientId: "key",
    });
  });
});
