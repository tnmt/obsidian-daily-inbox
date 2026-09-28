import { Setting } from "obsidian";
import type { OnThisDaySettings } from "./settings";

export interface OnThisDaySettingsHost {
  readonly settings: OnThisDaySettings;
  saveSettings(): Promise<void>;
}

// Renders into an existing PluginSettingTab's containerEl, following
// dropbox/settings-tab.ts's plain-function + host interface pattern.
// `rerender` is called after the heading is committed (on blur), since a
// changed heading changes what the next query returns.
export function renderOnThisDaySettings(
  containerEl: HTMLElement,
  host: OnThisDaySettingsHost,
  rerender: () => void,
): void {
  containerEl.createEl("h3", { text: "On this day" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Shows every Daily Note in the vault that shares this date's month and day, " +
      "resolved by filename anywhere in the vault. Past years are listed nearest first, " +
      "then future years — useful when reviewing an older Daily Note and wanting to see " +
      "the same date in later years, up to today.",
  });

  new Setting(containerEl)
    .setName("Excerpt heading")
    .setDesc(
      'Markdown heading whose section is used as each item\'s excerpt, e.g. "## 📝 Journal". ' +
        "Falls back to the start of the note when the heading is absent.",
    )
    .addText((text) => {
      let committed = host.settings.excerptHeading;
      text.setValue(committed).onChange(async (value) => {
        host.settings.excerptHeading = value;
        await host.saveSettings();
      });
      text.inputEl.addEventListener("blur", () => {
        if (host.settings.excerptHeading === committed) return;
        committed = host.settings.excerptHeading;
        rerender();
      });
    });
}
