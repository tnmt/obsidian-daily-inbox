import { describe, expect, it } from "vitest";
import { defaultHistoryPath, localStatePath, userDataDir } from "./browser-paths";

const MAC_HOME = "/Users/example";
const LINUX_HOME = "/home/example";

describe("userDataDir", () => {
  it("resolves Brave Origin's user data directory on macOS", () => {
    expect(userDataDir("brave-origin", MAC_HOME, "macos")).toBe(
      "/Users/example/Library/Application Support/BraveSoftware/Brave-Origin",
    );
  });

  it("resolves Chrome's user data directory on macOS", () => {
    expect(userDataDir("chrome", MAC_HOME, "macos")).toBe(
      "/Users/example/Library/Application Support/Google/Chrome",
    );
  });

  it("resolves Brave Origin's user data directory on Linux", () => {
    expect(userDataDir("brave-origin", LINUX_HOME, "linux")).toBe(
      "/home/example/.config/BraveSoftware/Brave-Origin",
    );
  });

  it("resolves Chrome's user data directory on Linux", () => {
    expect(userDataDir("chrome", LINUX_HOME, "linux")).toBe("/home/example/.config/google-chrome");
  });
});

describe("localStatePath", () => {
  it("appends Local State to the user data directory", () => {
    expect(localStatePath("chrome", MAC_HOME, "macos")).toBe(
      "/Users/example/Library/Application Support/Google/Chrome/Local State",
    );
    expect(localStatePath("chrome", LINUX_HOME, "linux")).toBe("/home/example/.config/google-chrome/Local State");
  });
});

describe("defaultHistoryPath", () => {
  it("appends the profile directory and History to the user data directory", () => {
    expect(defaultHistoryPath("chrome", MAC_HOME, "macos", "Profile 1")).toBe(
      "/Users/example/Library/Application Support/Google/Chrome/Profile 1/History",
    );
    expect(defaultHistoryPath("chrome", LINUX_HOME, "linux", "Profile 1")).toBe(
      "/home/example/.config/google-chrome/Profile 1/History",
    );
  });
});
