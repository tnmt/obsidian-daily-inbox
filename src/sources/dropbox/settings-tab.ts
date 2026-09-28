import { Notice, Setting } from "obsidian";
import type { ButtonComponent } from "obsidian";
import type { DropboxAuthManager } from "./auth";
import type { DropboxSettings } from "./settings";
import { describeDropboxSetupStatus, getDropboxSetupStatus } from "./setup-status";

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

  // Kept in sync with the App Key field below so the connection status and
  // the Connect button's disabled state update as the user types, without
  // re-rendering the whole tab (which would drop focus out of the field
  // mid-edit).
  let syncWithAppKey: (() => void) | undefined;

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
          syncWithAppKey?.();
        }),
    );

  renderFolderPathsSetting(containerEl, host, rerender);

  syncWithAppKey = renderConnectionSetting(containerEl, host, rerender);
}

// Each row edits one entry of `folderPaths` independently; DropboxSource
// searches all of them and merges results (docs/architecture.md "Multi-folder
// search").
function renderFolderPathsSetting(
  containerEl: HTMLElement,
  host: DropboxSettingsHost,
  rerender: () => void,
): void {
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Dropbox folders to look for photos in, searched independently with results merged. Use " +
      '"{year}" in a path to track a per-year archive folder, e.g. "/Pictures/Archive/{year}". ' +
      "Full Dropbox access is required for this app because Camera Uploads lives outside any " +
      "app-scoped folder — the token can read outside these folders as a result of that scope grant.",
  });

  host.settings.folderPaths.forEach((path, index) => {
    let committedValue = path;
    new Setting(containerEl)
      .setName(index === 0 ? "Folder" : `Folder ${index + 1}`)
      .addText((text) => {
        text
          .setPlaceholder("/Camera Uploads")
          .setValue(path)
          .onChange(async (value) => {
            host.settings.folderPaths[index] = value.trim();
            await host.saveSettings();
          });
        // Re-query on blur rather than on every keystroke — the folder isn't
        // "committed" until the user is done editing it.
        text.inputEl.addEventListener("blur", () => {
          if (host.settings.folderPaths[index] === committedValue) return;
          committedValue = host.settings.folderPaths[index];
          rerender();
        });
      })
      .addExtraButton((button) =>
        button
          .setIcon("trash")
          .setTooltip("Remove this folder")
          .onClick(async () => {
            host.settings.folderPaths.splice(index, 1);
            await host.saveSettings();
            rerender();
          }),
      );
  });

  new Setting(containerEl).addButton((button) =>
    button.setButtonText("Add folder").onClick(async () => {
      host.settings.folderPaths.push("");
      await host.saveSettings();
      rerender();
    }),
  );
}

function renderConnectionSetting(
  containerEl: HTMLElement,
  host: DropboxSettingsHost,
  rerender: () => void,
): (() => void) | undefined {
  const describeStatus = () => describeDropboxSetupStatus(getDropboxSetupStatus(host.settings, host.auth));
  const connectionSetting = new Setting(containerEl).setName("Dropbox connection").setDesc(describeStatus());

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
    const hasAppKey = () => host.settings.clientId.trim().length > 0;
    let button: ButtonComponent | undefined;
    connectionSetting.addButton((b) => {
      button = b
        .setButtonText("Connect to Dropbox")
        .setCta()
        .setDisabled(!hasAppKey())
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
    return () => {
      connectionSetting.setDesc(describeStatus());
      button?.setDisabled(!hasAppKey());
    };
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
