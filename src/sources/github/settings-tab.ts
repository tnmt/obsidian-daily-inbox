import { Setting } from "obsidian";
import type { GitHubSettings } from "./settings";

export interface GitHubSettingsHost {
  readonly settings: GitHubSettings;
  saveSettings(): Promise<void>;
}

// Follows the other sources' plain-function + host interface pattern.
// `rerender` runs when a field loses focus after a change, since a new login
// or token changes both availability and what the next query returns.
export function renderGitHubSettings(
  containerEl: HTMLElement,
  host: GitHubSettingsHost,
  rerender: () => void,
): void {
  containerEl.createEl("h3", { text: "GitHub" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Shows your commits, pull requests and issues on the date, read through GitHub's search API. " +
      "Commit search covers only each repository's default branch. The token is stored in this " +
      "plugin's data.json inside the vault, in plain text; keep data.json out of anything the vault " +
      "is shared or backed up to. A read-only token is enough; private repositories need access to them.",
  });

  const field = (
    name: string,
    desc: string,
    key: keyof GitHubSettings,
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

  field("Username", "Your GitHub login.", "username", (input) => {
    input.placeholder = "octocat";
  });
  field("Access token", "Personal access token for the search API.", "token", (input) => {
    input.type = "password";
  });
}
