import { Setting } from "obsidian";
import type { LocationSettings } from "./settings";

export interface LocationSettingsHost {
  readonly settings: LocationSettings;
  saveSettings(): Promise<void>;
}

// Follows the other sources' plain-function + host interface pattern.
// `rerender` runs when a field loses focus after a change, since a new URL or
// token changes both availability and what the next query returns.
export function renderLocationSettings(
  containerEl: HTMLElement,
  host: LocationSettingsHost,
  rerender: () => void,
): void {
  containerEl.createEl("h3", { text: "Location" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Shows where you stayed and how you moved on the date, read from an overland-server " +
      "instance's GET /api/days/{date}. The token is stored in this plugin's data.json inside " +
      "the vault, in plain text; keep data.json out of anything the vault is shared or backed up to.",
  });

  const field = (
    name: string,
    desc: string,
    key: keyof LocationSettings,
    configure: (input: HTMLInputElement) => void,
  ) =>
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        let committed = host.settings[key];
        configure(text.inputEl);
        text.setValue(committed).onChange(async (value) => {
          host.settings[key] = value.trim();
          await host.saveSettings();
        });
        text.inputEl.addEventListener("blur", () => {
          if (host.settings[key] === committed) return;
          committed = host.settings[key];
          rerender();
        });
      });

  field("Server URL", "Base URL of the server, without the /api path.", "baseUrl", (input) => {
    input.placeholder = "https://overland.example.com";
  });
  field("Read token", "Bearer token for the server's read API.", "token", (input) => {
    input.type = "password";
  });
}
