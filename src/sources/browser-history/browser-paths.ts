export type ChromiumBrowser = "brave-origin" | "chrome";

// Default-path detection covers macOS and Linux, the two desktop platforms
// this plugin's users have actually tested on. Windows and any other
// Chromium-based browser (e.g. plain Chromium, which is a different product
// from Google Chrome even on the same engine) are reached through the
// settings tab's custom History path field instead of guessed defaults.
export type SupportedOs = "macos" | "linux";

function userDataDirName(browser: ChromiumBrowser, os: SupportedOs): string {
  if (os === "linux") {
    switch (browser) {
      case "brave-origin":
        return ".config/BraveSoftware/Brave-Origin";
      case "chrome":
        return ".config/google-chrome";
    }
  }
  switch (browser) {
    case "brave-origin":
      return "Library/Application Support/BraveSoftware/Brave-Origin";
    case "chrome":
      return "Library/Application Support/Google/Chrome";
  }
}

export function userDataDir(browser: ChromiumBrowser, homeDir: string, os: SupportedOs): string {
  return `${homeDir}/${userDataDirName(browser, os)}`;
}

export function localStatePath(browser: ChromiumBrowser, homeDir: string, os: SupportedOs): string {
  return `${userDataDir(browser, homeDir, os)}/Local State`;
}

export function defaultHistoryPath(
  browser: ChromiumBrowser,
  homeDir: string,
  os: SupportedOs,
  profileDirectoryName: string,
): string {
  return `${userDataDir(browser, homeDir, os)}/${profileDirectoryName}/History`;
}
