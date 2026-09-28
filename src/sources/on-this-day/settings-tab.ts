import { Setting } from "obsidian";
import type { OnThisDaySettings } from "./settings";

export interface OnThisDaySettingsHost {
  readonly settings: OnThisDaySettings;
  saveSettings(): Promise<void>;
}

// Renders into an existing PluginSettingTab's containerEl, following
// dropbox/settings-tab.ts's plain-function + host interface pattern.
// `rerender` is called after a field is committed (on blur), since a changed
// yearsBack/heading changes what the next query returns.
export function renderOnThisDaySettings(
  containerEl: HTMLElement,
  host: OnThisDaySettingsHost,
  rerender: () => void,
): void {
  containerEl.createEl("h3", { text: "On this day" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Shows Daily Notes from the same calendar date in previous years, resolved by filename " +
      "anywhere in the vault.",
  });

  new Setting(containerEl).setName("Years to look back").addText((text) => {
    let committed = String(host.settings.yearsBack);
    text.setValue(committed).onChange(async (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) return;
      host.settings.yearsBack = parsed;
      await host.saveSettings();
    });
    text.inputEl.addEventListener("blur", () => {
      const current = String(host.settings.yearsBack);
      if (current === committed) return;
      committed = current;
      rerender();
    });
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
