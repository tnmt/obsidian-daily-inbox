import { defaultHistoryPath, type ChromiumBrowser, type SupportedOs } from "./browser-paths";

export type { ChromiumBrowser, SupportedOs };

export interface BrowserHistoryProfileSettings {
  /** Stable identity independent of array position, so removing one profile never relabels another's ContextSource.id. */
  configId: string;
  browser: ChromiumBrowser;
  label: string;
  profileSource: "detected" | "custom";
  profileDirectoryName?: string;
  customHistoryPath?: string;
  excludedDomains: string[];
}

export interface BrowserHistorySettings {
  profiles: BrowserHistoryProfileSettings[];
}

export const DEFAULT_BROWSER_HISTORY_SETTINGS: BrowserHistorySettings = { profiles: [] };

export function resolveHistoryPath(profile: BrowserHistoryProfileSettings, homeDir: string, os: SupportedOs): string {
  if (profile.profileSource === "custom") return (profile.customHistoryPath ?? "").trim();
  if (!profile.profileDirectoryName) return "";
  return defaultHistoryPath(profile.browser, homeDir, os, profile.profileDirectoryName);
}
