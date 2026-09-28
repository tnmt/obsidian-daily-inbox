import { Notice, Platform, Setting } from "obsidian";
import type { ButtonComponent, DropdownComponent } from "obsidian";
import type { ChromiumBrowser } from "./browser-paths";
import type { DetectedProfile } from "./local-state";
import type { BrowserHistoryProfileSettings, BrowserHistorySettings } from "./settings";

export interface BrowserHistorySettingsHost {
  readonly settings: BrowserHistorySettings;
  saveSettings(): Promise<void>;
  detectProfiles(browser: ChromiumBrowser): Promise<DetectedProfile[]>;
  resolvePath(profile: BrowserHistoryProfileSettings): string;
}

const BROWSER_LABELS: Record<ChromiumBrowser, string> = {
  chrome: "Chrome",
  "brave-origin": "Brave Origin",
};

const CUSTOM_PROFILE_VALUE = "__custom__";

// Renders into an existing PluginSettingTab's containerEl, following
// dropbox/settings-tab.ts's plain-function + host interface pattern.
// `rerender` is called after any action that changes the configured profile
// list, since this function itself only ever draws once per call.
export function renderBrowserHistorySettings(
  containerEl: HTMLElement,
  host: BrowserHistorySettingsHost,
  rerender: () => void,
): void {
  containerEl.createEl("h3", { text: "Browser history" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Reads a local copy of Brave Origin's/Chrome's History file for the Daily Note's date. Nothing leaves " +
      "this machine — a temporary copy is made to read around the browser's file lock, then deleted " +
      "immediately after. Desktop only.",
  });

  if (!Platform.isDesktopApp) {
    containerEl.createEl("p", { text: "Browser history is desktop-only.", cls: "setting-item-description" });
    return;
  }

  renderAddProfile(containerEl, host, rerender);

  for (const profile of host.settings.profiles) {
    renderProfileSettings(containerEl, host, profile, rerender);
  }
}

function renderAddProfile(containerEl: HTMLElement, host: BrowserHistorySettingsHost, rerender: () => void): void {
  containerEl.createEl("h4", { text: "Add a profile" });

  let selectedBrowser: ChromiumBrowser = "chrome";
  let selectedProfileValue: string = CUSTOM_PROFILE_VALUE;
  let customPath = "";
  let detected: DetectedProfile[] = [];
  let profileDropdown: DropdownComponent | undefined;
  let addButton: ButtonComponent | undefined;
  // Bumped on every detection request; a request whose token no longer
  // matches when it resolves was superseded by a later browser switch, so its
  // (possibly out-of-order) result is discarded instead of overwriting the
  // current selection.
  let detectionToken = 0;

  const customPathSetting = new Setting(containerEl)
    .setName("Custom History path")
    .setDesc("Absolute path to a History file, for profiles or installs that aren't auto-detected.")
    .addText((text) => text.setPlaceholder("/path/to/History").onChange((value) => (customPath = value.trim())));

  function updateCustomPathVisibility(): void {
    customPathSetting.settingEl.toggleClass("is-hidden", selectedProfileValue !== CUSTOM_PROFILE_VALUE);
  }

  async function refreshProfileOptions(): Promise<void> {
    if (!profileDropdown) return;
    const token = ++detectionToken;
    const browserAtRequest = selectedBrowser;
    const select = profileDropdown.selectEl;
    select.empty();
    profileDropdown.addOption(CUSTOM_PROFILE_VALUE, "Detecting profiles…");
    profileDropdown.setValue(CUSTOM_PROFILE_VALUE);
    addButton?.setDisabled(true);
    let result: DetectedProfile[];
    try {
      result = await host.detectProfiles(browserAtRequest);
    } catch {
      result = [];
    }
    if (token !== detectionToken) return; // superseded by a later browser switch
    detected = result;
    select.empty();
    for (const p of detected) profileDropdown.addOption(p.directoryName, p.displayName);
    profileDropdown.addOption(CUSTOM_PROFILE_VALUE, "Custom path…");
    selectedProfileValue = detected[0]?.directoryName ?? CUSTOM_PROFILE_VALUE;
    profileDropdown.setValue(selectedProfileValue);
    updateCustomPathVisibility();
    addButton?.setDisabled(false);
  }

  new Setting(containerEl).setName("Browser").addDropdown((dropdown) => {
    dropdown.addOption("chrome", BROWSER_LABELS.chrome);
    dropdown.addOption("brave-origin", BROWSER_LABELS["brave-origin"]);
    dropdown.setValue(selectedBrowser);
    dropdown.onChange(async (value) => {
      selectedBrowser = value as ChromiumBrowser;
      await refreshProfileOptions();
    });
  });

  new Setting(containerEl).setName("Profile").addDropdown((dropdown) => {
    profileDropdown = dropdown;
    dropdown.onChange((value) => {
      selectedProfileValue = value;
      updateCustomPathVisibility();
    });
  });

  new Setting(containerEl).addButton((button) => {
    addButton = button;
    button
      .setButtonText("Add")
      .setCta()
      .onClick(async () => {
        const isCustom = selectedProfileValue === CUSTOM_PROFILE_VALUE;
        if (isCustom && customPath.length === 0) {
          new Notice("Enter a History file path first.");
          return;
        }
        const detectedProfile = detected.find((p) => p.directoryName === selectedProfileValue);
        const profile: BrowserHistoryProfileSettings = {
          configId: crypto.randomUUID(),
          browser: selectedBrowser,
          label: isCustom
            ? `${BROWSER_LABELS[selectedBrowser]} — custom`
            : `${BROWSER_LABELS[selectedBrowser]} — ${detectedProfile?.displayName ?? selectedProfileValue}`,
          profileSource: isCustom ? "custom" : "detected",
          profileDirectoryName: isCustom ? undefined : selectedProfileValue,
          customHistoryPath: isCustom ? customPath : undefined,
          excludedDomains: [],
        };
        host.settings.profiles.push(profile);
        await host.saveSettings();
        rerender();
      });
  });

  void refreshProfileOptions();
}

function renderProfileSettings(
  containerEl: HTMLElement,
  host: BrowserHistorySettingsHost,
  profile: BrowserHistoryProfileSettings,
  rerender: () => void,
): void {
  containerEl.createEl("h4", { text: profile.label });

  new Setting(containerEl).setName("Section name").addText((text) => {
    let committed = profile.label;
    text.setValue(profile.label).onChange(async (value) => {
      profile.label = value.trim() || committed;
      await host.saveSettings();
    });
    text.inputEl.addEventListener("blur", () => {
      if (profile.label === committed) return;
      committed = profile.label;
      rerender();
    });
  });

  new Setting(containerEl).setName("History path").setDesc(host.resolvePath(profile) || "(not resolved)");

  new Setting(containerEl)
    .setName("Excluded domains")
    .setDesc("Comma-separated domains to hide, e.g. example.com, internal.tool. Subdomains are excluded too.")
    .addText((text) => {
      let committed = profile.excludedDomains.join(", ");
      text.setValue(committed).onChange(async (value) => {
        profile.excludedDomains = value
          .split(",")
          .map((d) => d.trim())
          .filter((d) => d.length > 0);
        await host.saveSettings();
      });
      // Re-query on blur rather than on every keystroke, matching the
      // section-name field above — otherwise an already-rendered day's items
      // wouldn't reflect a newly excluded domain until some unrelated refresh.
      text.inputEl.addEventListener("blur", () => {
        const current = profile.excludedDomains.join(", ");
        if (current === committed) return;
        committed = current;
        rerender();
      });
    });

  new Setting(containerEl).addButton((button) =>
    button
      .setButtonText("Remove")
      .setWarning()
      .onClick(async () => {
        host.settings.profiles = host.settings.profiles.filter((p) => p.configId !== profile.configId);
        await host.saveSettings();
        rerender();
      }),
  );
}
