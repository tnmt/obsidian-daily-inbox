import { ItemView, Plugin, PluginSettingTab, WorkspaceLeaf, requestUrl } from "obsidian";
import type { App } from "obsidian";
import { FileNameDateResolver } from "./domain";
import type { ContextItem, DailyContext, LocalDate } from "./domain";
import { DropboxAuthManager } from "./sources/dropbox/auth";
import type { DropboxAuthPersistence, DropboxTokens } from "./sources/dropbox/auth";
import { CancelledError } from "./sources/dropbox/cancel";
import { DropboxSource } from "./sources/dropbox/dropbox-source";
import { DropboxSourceError } from "./sources/dropbox/errors";
import { DEFAULT_DROPBOX_SETTINGS } from "./sources/dropbox/settings";
import type { DropboxSettings } from "./sources/dropbox/settings";
import { renderDropboxSettings } from "./sources/dropbox/settings-tab";
import type { DropboxSettingsHost } from "./sources/dropbox/settings-tab";

export * from "./domain";

export const DAILY_INBOX_VIEW_TYPE = "daily-inbox-view";

interface DailyInboxPluginData {
  dropbox: DropboxSettings;
  dropboxTokens?: DropboxTokens;
}

// The Dropbox section's own render state, independent of whether a Daily
// Context could be resolved at all (main render() below handles that part).
type DropboxSectionState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "loading" }
  | { readonly kind: "items"; readonly items: ContextItem[] }
  | { readonly kind: "error"; readonly message: string };

function describeDropboxError(err: unknown): string {
  if (err instanceof DropboxSourceError) {
    switch (err.kind) {
      case "auth-required":
        return "Dropbox re-authentication is required. Check the plugin settings.";
      case "not-found":
        return "The configured Dropbox folder was not found.";
      case "transient":
        return "Could not reach Dropbox. Try refreshing.";
    }
  }
  return "Unexpected error while querying Dropbox.";
}

class DailyInboxView extends ItemView {
  private readonly dateResolver = new FileNameDateResolver();
  private refreshController?: AbortController;
  private refreshSequence = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: DailyInboxPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string { return DAILY_INBOX_VIEW_TYPE; }
  getDisplayText(): string { return "Daily Inbox"; }

  async onOpen(): Promise<void> { await this.refresh(); }

  async onClose(): Promise<void> { this.refreshController?.abort(); }

  async refresh(): Promise<void> {
    const sequence = ++this.refreshSequence;
    this.refreshController?.abort();
    const controller = new AbortController();
    this.refreshController = controller;
    const activeFile = this.app.workspace.getActiveFile();
    const date = this.dateResolver.resolve(activeFile);
    const context: DailyContext | undefined = date && activeFile ? { date, activeFile } : undefined;

    if (!context) {
      this.render(date, undefined);
      return;
    }

    if (!this.plugin.dropboxSource.isAvailable()) {
      this.render(date, context, { kind: "unavailable" });
      return;
    }

    this.render(date, context, { kind: "loading" });
    try {
      const items = await this.plugin.dropboxSource.getItems(context, controller.signal);
      if (this.isStale(controller, sequence)) return;
      this.render(date, context, { kind: "items", items });
    } catch (err) {
      if (err instanceof CancelledError) return;
      if (this.isStale(controller, sequence)) return;
      this.render(date, context, { kind: "error", message: describeDropboxError(err) });
    }
  }

  private isStale(controller: AbortController, sequence: number): boolean {
    return controller.signal.aborted || sequence !== this.refreshSequence;
  }

  private render(
    date: LocalDate | undefined,
    context: DailyContext | undefined,
    dropbox?: DropboxSectionState,
  ): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Daily Inbox" });
    if (!date || !context) {
      this.contentEl.createEl("p", { text: "No Daily Note date resolved." });
      this.contentEl.createEl("p", {
        text: "Open a note named YYYY-MM-DD.md to view its Daily Context.",
      });
      return;
    }
    this.contentEl.createEl("p", { text: `Daily Inbox: ${date}` });
    this.renderDropboxSection(dropbox);
  }

  private renderDropboxSection(state: DropboxSectionState | undefined): void {
    const section = this.contentEl.createDiv({ cls: "daily-inbox-source" });
    section.createEl("h3", { text: "Dropbox" });

    if (!state || state.kind === "unavailable") {
      section.createEl("p", {
        text: "Dropbox is not configured. Connect it in the plugin settings.",
        cls: "daily-inbox-empty",
      });
      return;
    }
    if (state.kind === "loading") {
      section.createEl("p", { text: "Loading…", cls: "daily-inbox-empty" });
      return;
    }
    if (state.kind === "error") {
      section.createEl("p", { text: state.message, cls: "daily-inbox-error" });
      return;
    }
    if (state.items.length === 0) {
      section.createEl("p", { text: "No photos for this date.", cls: "daily-inbox-empty" });
      return;
    }
    const list = section.createEl("ul");
    for (const item of state.items) {
      list.createEl("li", { text: item.title ?? item.id });
    }
  }
}

class DailyInboxSettingTab extends PluginSettingTab implements DropboxSettingsHost {
  constructor(
    app: App,
    private readonly plugin: DailyInboxPlugin,
  ) {
    super(app, plugin);
  }

  get settings(): DropboxSettings {
    return this.plugin.data.dropbox;
  }

  get auth(): DropboxAuthManager {
    return this.plugin.dropboxAuth;
  }

  async saveSettings(): Promise<void> {
    await this.plugin.savePluginData();
  }

  display(): void {
    this.containerEl.empty();
    renderDropboxSettings(this.containerEl, this, () => this.display());
  }
}

export default class DailyInboxPlugin extends Plugin {
  data: DailyInboxPluginData = { dropbox: { ...DEFAULT_DROPBOX_SETTINGS } };
  dropboxAuth!: DropboxAuthManager;
  dropboxSource!: DropboxSource;

  async onload(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<DailyInboxPluginData> | null;
    this.data = {
      dropbox: { ...DEFAULT_DROPBOX_SETTINGS, ...loaded?.dropbox },
      dropboxTokens: loaded?.dropboxTokens,
    };

    const persistence: DropboxAuthPersistence = {
      load: () => this.data.dropboxTokens,
      save: async (tokens) => {
        this.data.dropboxTokens = tokens;
        await this.savePluginData();
      },
    };
    this.dropboxAuth = new DropboxAuthManager(requestUrl, () => this.data.dropbox.clientId, persistence);
    this.dropboxSource = new DropboxSource(requestUrl, this.dropboxAuth, () => this.data.dropbox.folderPath);

    this.registerView(DAILY_INBOX_VIEW_TYPE, (leaf) => new DailyInboxView(leaf, this));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      for (const leaf of this.app.workspace.getLeavesOfType(DAILY_INBOX_VIEW_TYPE)) {
        const view = leaf.view;
        if (view instanceof DailyInboxView) void view.refresh();
      }
    }));
    this.addCommand({
      id: "open-daily-inbox",
      name: "Open Daily Inbox",
      callback: () => this.activateView(),
    });
    this.addSettingTab(new DailyInboxSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(DAILY_INBOX_VIEW_TYPE);
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DAILY_INBOX_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: DAILY_INBOX_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
