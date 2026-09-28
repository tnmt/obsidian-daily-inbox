import type { DropboxSettings } from "./settings";

export type DropboxSetupStatus =
  | "missing-app-key"
  | "not-connected"
  | "awaiting-code"
  | "missing-folder"
  | "ready";

export interface DropboxConnectionState {
  isConnected(): boolean;
  hasPendingAuthorization(): boolean;
}

export function getDropboxSetupStatus(
  settings: DropboxSettings,
  auth: DropboxConnectionState,
): DropboxSetupStatus {
  if (!auth.isConnected()) {
    if (auth.hasPendingAuthorization()) return "awaiting-code";
    if (settings.clientId.trim().length === 0) return "missing-app-key";
    return "not-connected";
  }
  if (settings.folderPath.trim().length === 0) return "missing-folder";
  return "ready";
}

export function describeDropboxSetupStatus(status: DropboxSetupStatus): string {
  switch (status) {
    case "missing-app-key":
      return "Not connected. Enter a Dropbox App Key, then connect.";
    case "not-connected":
      return "Not connected.";
    case "awaiting-code":
      return "Waiting for the authorization code from dropbox.com.";
    case "missing-folder":
      return "Connected, but no folder is configured.";
    case "ready":
      return "Connected.";
  }
}
