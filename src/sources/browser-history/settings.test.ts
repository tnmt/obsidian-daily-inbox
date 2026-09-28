import { describe, expect, it } from "vitest";
import { resolveHistoryPath, type BrowserHistoryProfileSettings } from "./settings";

const HOME = "/Users/example";

function profile(overrides: Partial<BrowserHistoryProfileSettings> = {}): BrowserHistoryProfileSettings {
  return {
    configId: "id-1",
    browser: "chrome",
    label: "Chrome — Default",
    profileSource: "detected",
    profileDirectoryName: "Default",
    excludedDomains: [],
    ...overrides,
  };
}

describe("resolveHistoryPath", () => {
  it("builds the default path for a detected profile", () => {
    expect(resolveHistoryPath(profile(), HOME, "macos")).toBe(
      "/Users/example/Library/Application Support/Google/Chrome/Default/History",
    );
  });

  it("builds the Linux default path for a detected profile", () => {
    expect(resolveHistoryPath(profile(), "/home/example", "linux")).toBe(
      "/home/example/.config/google-chrome/Default/History",
    );
  });

  it("returns an empty string for a detected profile with no directory name", () => {
    expect(resolveHistoryPath(profile({ profileDirectoryName: undefined }), HOME, "macos")).toBe("");
  });

  it("uses the custom path for a custom profile", () => {
    expect(
      resolveHistoryPath(profile({ profileSource: "custom", customHistoryPath: " /custom/History " }), HOME, "macos"),
    ).toBe("/custom/History");
  });

  it("returns an empty string for a custom profile with no path", () => {
    expect(resolveHistoryPath(profile({ profileSource: "custom", customHistoryPath: undefined }), HOME, "macos")).toBe(
      "",
    );
  });
});
