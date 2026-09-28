import { describe, expect, it } from "vitest";
import { getDropboxSetupStatus } from "./setup-status";

function auth(connected: boolean, pending = false) {
  return { isConnected: () => connected, hasPendingAuthorization: () => pending };
}

describe("getDropboxSetupStatus", () => {
  it("asks for an App Key before anything else when not connected", () => {
    expect(getDropboxSetupStatus({ clientId: " ", folderPaths: [] }, auth(false))).toBe("missing-app-key");
  });

  it("reports not-connected once an App Key is present", () => {
    expect(getDropboxSetupStatus({ clientId: "key", folderPaths: ["/Camera Uploads"] }, auth(false))).toBe(
      "not-connected",
    );
  });

  it("reports a pending authorization attempt", () => {
    expect(
      getDropboxSetupStatus({ clientId: "key", folderPaths: ["/Camera Uploads"] }, auth(false, true)),
    ).toBe("awaiting-code");
  });

  it("reports a missing folder even when connected", () => {
    expect(getDropboxSetupStatus({ clientId: "key", folderPaths: ["  "] }, auth(true))).toBe("missing-folder");
  });

  it("reports a missing folder when no path entries are configured at all", () => {
    expect(getDropboxSetupStatus({ clientId: "key", folderPaths: [] }, auth(true))).toBe("missing-folder");
  });

  it("is ready once at least one configured folder is non-blank", () => {
    expect(
      getDropboxSetupStatus({ clientId: "key", folderPaths: ["  ", "/Camera Uploads"] }, auth(true)),
    ).toBe("ready");
  });
});
