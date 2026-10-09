import { Notice, Setting } from "obsidian";
import type { ButtonComponent } from "obsidian";
import { CancelledError } from "../dropbox/cancel";
import type { WithingsAuthManager } from "./auth";
import { redirectUri } from "./callback-server";
import type { WithingsSettings } from "./settings";
import { hasWithingsCredentials } from "./settings";

export interface WithingsSettingsHost {
  readonly settings: WithingsSettings;
  readonly auth: WithingsAuthManager;
  saveSettings(): Promise<void>;
}

// Renders into an existing PluginSettingTab's containerEl. `rerender` runs
// after any change to the connection state.
export function renderWithingsSettings(
  containerEl: HTMLElement,
  host: WithingsSettingsHost,
  rerender: () => void,
): void {
  containerEl.createEl("h3", { text: "Withings" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text:
      "Shows body measurements from a Withings scale. Register your own application at " +
      `developer.withings.com with the redirect URI ${redirectUri()} and the scope user.metrics, ` +
      "then enter its Client ID and Client Secret. Tokens and the secret are stored in this plugin's " +
      "data.json inside the vault, in plain text; keep data.json out of anything the vault is shared " +
      "or backed up to.",
  });

  // Updates the not-connected row as the credentials are typed, without
  // re-rendering the tab, which would drop focus out of the field mid-edit.
  let syncConnect: (() => void) | undefined;

  const field = (name: string, key: keyof WithingsSettings, secret: boolean) =>
    new Setting(containerEl).setName(name).addText((text) => {
      if (secret) text.inputEl.type = "password";
      text.setValue(host.settings[key]).onChange(async (value) => {
        const trimmed = value.trim();
        const changed = trimmed !== host.settings[key];
        host.settings[key] = trimmed;
        await host.saveSettings();
        // Stored tokens belong to the application that issued them.
        if (changed && (host.auth.isConnected() || host.auth.hasPendingAuthorization())) {
          await host.auth.disconnect();
          rerender();
          return;
        }
        syncConnect?.();
      });
    });
  field("Client ID", "clientId", false);
  field("Client Secret", "clientSecret", true);

  const connection = new Setting(containerEl).setName("Withings connection");
  if (host.auth.isConnected()) {
    connection.setDesc("Connected.").addButton((button) =>
      button.setButtonText("Disconnect").onClick(async () => {
        await host.auth.disconnect();
        rerender();
      }),
    );
  } else if (host.auth.hasPendingAuthorization()) {
    connection.setDesc("Waiting for approval in the browser.").addButton((button) =>
      button.setButtonText("Cancel").onClick(() => host.auth.cancelAuthorization()),
    );
  } else {
    const describe = () =>
      hasWithingsCredentials(host.settings) ? "Not connected." : "Enter the Client ID and Client Secret first.";
    let connectButton: ButtonComponent | undefined;
    connection.setDesc(describe()).addButton((button) => {
      connectButton = button;
      button
        .setButtonText("Connect to Withings")
        .setCta()
        .setDisabled(!hasWithingsCredentials(host.settings))
        .onClick(async () => {
            // connect() resolves only after the browser round trip, so the
            // pending state is drawn first and the result afterwards.
            const connecting = host.auth.connect((url) => window.open(url));
            rerender();
            try {
              await connecting;
            } catch (err) {
              if (!(err instanceof CancelledError)) {
                new Notice(err instanceof Error ? err.message : "Could not connect to Withings.");
              }
            } finally {
              rerender();
            }
          });
    });
    syncConnect = () => {
      connection.setDesc(describe());
      connectButton?.setDisabled(!hasWithingsCredentials(host.settings));
    };
  }
}
