import { Notice, Setting } from "obsidian";
import type { ButtonComponent } from "obsidian";
import type { DropboxAuthManager } from "./auth";
import type { DropboxSettings } from "./settings";

export interface DropboxSettingsHost {
  readonly settings: DropboxSettings;
  readonly auth: DropboxAuthManager;
  saveSettings(): Promise<void>;
}

function reportError(err: unknown): void {
  new Notice(err instanceof Error ? err.message : "Something went wrong talking to Dropbox.");
}

// Renders into an existing PluginSettingTab's containerEl. `rerender` is
// called after any action that changes connection state, since this
// function itself only ever draws once per call.
export function renderDropboxSettings(
  containerEl: HTMLElement,
  host: DropboxSettingsHost,
  rerender: () => void,
): void {
  containerEl.createEl("h3", { text: "Dropbox" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Dropbox tokens are stored in this plugin's data.json inside the vault, in plain text, " +
      "not secret storage. If this vault is tracked with git, make sure data.json is gitignored " +
      "— that only stops new commits, it does not protect against vault sync or backups.",
  });

  // Kept in sync with the App Key field below so the Connect button's
  // disabled state updates as the user types, without re-rendering the
  // whole tab (which would drop focus out of the field mid-edit).
  let connectButton: ButtonComponent | undefined;

  new Setting(containerEl)
    .setName("Dropbox App Key")
    .setDesc("The client_id of the Dropbox app registered for this plugin.")
    .addText((text) =>
      text
        .setPlaceholder("App key")
        .setValue(host.settings.clientId)
        .onChange(async (value) => {
          const trimmed = value.trim();
          const changed = trimmed !== host.settings.clientId;
          host.settings.clientId = trimmed;
          await host.saveSettings();
          // A stored refresh token / in-progress code exchange is tied to
          // the App Key it was obtained with; switching keys invalidates
          // both, so drop them rather than let a mismatched request fail
          // confusingly later.
          if (changed && host.auth.isConnected()) {
            await host.auth.disconnect();
            rerender();
            return;
          }
          if (changed && host.auth.hasPendingAuthorization()) {
            host.auth.cancelAuthorization();
            rerender();
            return;
          }
          connectButton?.setDisabled(trimmed.length === 0);
        }),
    );

  new Setting(containerEl)
    .setName("Camera Uploads folder path")
    .setDesc(
      "The Dropbox folder to look for photos in. Full Dropbox access is required for this " +
        "app because Camera Uploads lives outside any app-scoped folder — the token can read " +
        "outside this folder as a result of that scope grant.",
    )
    .addText((text) => {
      text
        .setPlaceholder("/Camera Uploads")
        .setValue(host.settings.folderPath)
        .onChange(async (value) => {
          host.settings.folderPath = value.trim();
          await host.saveSettings();
        });
      // Re-query on blur rather than on every keystroke — the folder isn't
      // "committed" until the user is done editing it.
      text.inputEl.addEventListener("blur", () => rerender());
    });

  connectButton = renderConnectionSetting(containerEl, host, rerender);
}

function renderConnectionSetting(
  containerEl: HTMLElement,
  host: DropboxSettingsHost,
  rerender: () => void,
): ButtonComponent | undefined {
  const status = host.auth.isConnected() ? "Connected" : "Not connected";
  const connectionSetting = new Setting(containerEl).setName("Dropbox connection").setDesc(status);

  if (host.auth.isConnected()) {
    connectionSetting.addButton((button) =>
      button.setButtonText("Disconnect").onClick(async () => {
        await host.auth.disconnect();
        rerender();
      }),
    );
    return undefined;
  }

  if (!host.auth.hasPendingAuthorization()) {
    let button: ButtonComponent | undefined;
    connectionSetting.addButton((b) => {
      button = b
        .setButtonText("Connect to Dropbox")
        .setCta()
        .setDisabled(host.settings.clientId.trim().length === 0)
        .onClick(async () => {
          try {
            const url = await host.auth.beginAuthorization();
            window.open(url);
          } catch (err) {
            reportError(err);
          } finally {
            rerender();
          }
        });
    });
    return button;
  }

  containerEl.createEl("p", {
    text: "Approve access on dropbox.com, then paste the code it shows you below.",
  });
  let pastedCode = "";
  new Setting(containerEl)
    .setName("Authorization code")
    .addText((text) => text.onChange((value) => (pastedCode = value)))
    .addButton((button) =>
      button
        .setButtonText("Confirm")
        .setCta()
        .onClick(async () => {
          try {
            await host.auth.completeAuthorization(pastedCode);
          } catch (err) {
            reportError(err);
          } finally {
            rerender();
          }
        }),
    )
    .addButton((button) =>
      button.setButtonText("Cancel").onClick(() => {
        host.auth.cancelAuthorization();
        rerender();
      }),
    );
  return undefined;
}
