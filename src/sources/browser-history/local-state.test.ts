import { describe, expect, it } from "vitest";
import { parseLocalStateProfiles } from "./local-state";

describe("parseLocalStateProfiles", () => {
  it("extracts display names from profile.info_cache, sorted by name", () => {
    const json = JSON.stringify({
      profile: {
        info_cache: {
          Default: { name: "Work" },
          "Profile 1": { name: "Personal" },
        },
      },
    });
    expect(parseLocalStateProfiles(json)).toEqual([
      { directoryName: "Profile 1", displayName: "Personal" },
      { directoryName: "Default", displayName: "Work" },
    ]);
  });

  it("falls back to the directory name when a profile has no display name", () => {
    const json = JSON.stringify({ profile: { info_cache: { Default: {} } } });
    expect(parseLocalStateProfiles(json)).toEqual([{ directoryName: "Default", displayName: "Default" }]);
  });

  it("returns an empty list for malformed JSON", () => {
    expect(parseLocalStateProfiles("not json")).toEqual([]);
  });

  it("returns an empty list when info_cache is missing", () => {
    expect(parseLocalStateProfiles(JSON.stringify({}))).toEqual([]);
  });
});
