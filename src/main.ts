import { ItemView, Notice, Plugin, PluginSettingTab, WorkspaceLeaf, requestUrl, setIcon } from "obsidian";
import type { App } from "obsidian";
import {
  ClipboardUnsupportedError,
  CopyImageToClipboardAction,
  ImageDecodeError,
  encodePngWithCanvas,
  getBrowserImageClipboard,
} from "./actions/copy-image-to-clipboard";
import { DailyInboxRefresher, partitionItems } from "./daily-inbox-refresh";
import type { SectionState, SourceSection } from "./daily-inbox-refresh";
import { FileNameDateResolver } from "./domain";
import type { ContextItem, DailyContext, LocalDate } from "./domain";
import { DropboxAuthManager } from "./sources/dropbox/auth";
import type { DropboxAuthPersistence, DropboxTokens } from "./sources/dropbox/auth";
import { CancelledError } from "./sources/dropbox/cancel";
import { DropboxSource } from "./sources/dropbox/dropbox-source";
import type { DropboxImagePayload } from "./sources/dropbox/dropbox-source";
import { DropboxSourceError } from "./sources/dropbox/errors";
import { DEFAULT_DROPBOX_SETTINGS } from "./sources/dropbox/settings";
import type { DropboxSettings } from "./sources/dropbox/settings";
import { renderDropboxSettings } from "./sources/dropbox/settings-tab";
import type { DropboxSettingsHost } from "./sources/dropbox/settings-tab";
import { getDropboxSetupStatus } from "./sources/dropbox/setup-status";
import type { DropboxSetupStatus } from "./sources/dropbox/setup-status";

export * from "./domain";

export const DAILY_INBOX_VIEW_TYPE = "daily-inbox-view";

interface DailyInboxPluginData {
  dropbox: DropboxSettings;
  dropboxTokens?: DropboxTokens;
}

function describeDropboxError(err: unknown): string {
  if (err instanceof DropboxSourceError) {
    switch (err.kind) {
      case "auth-required":
        return "Dropbox re-authentication is required. Reconnect it in Settings → Daily Inbox.";
      case "not-found":
        return "The configured Dropbox folder was not found.";
      case "transient":
        return "Could not reach Dropbox. Try refreshing.";
    }
  }
  return "Unexpected error while querying Dropbox.";
}

function describeDropboxUnavailable(status: DropboxSetupStatus): string {
  if (status === "missing-folder") {
    return "No Dropbox folder is configured. Set one in Settings → Daily Inbox.";
  }
  return "Dropbox is not connected. Connect it in Settings → Daily Inbox.";
}

function describeCopyError(err: unknown): string {
  if (err instanceof DropboxSourceError) return describeDropboxError(err);
  if (err instanceof ClipboardUnsupportedError) return err.message;
  if (err instanceof ImageDecodeError) return "This photo's format cannot be copied to the clipboard.";
  return "Could not copy the photo to the clipboard.";
}

class DailyInboxView extends ItemView {
  private readonly dateResolver = new FileNameDateResolver();
  private readonly refresher: DailyInboxRefresher;
  private readonly sectionEls = new Map<SourceSection, HTMLElement>();
  private context: DailyContext | undefined;
  private copyController?: AbortController;
  // active-leaf-change fires on plain focus changes too (switching panes,
  // focusing this view itself), not just when the resolved date changes.
  // Skip re-querying sources when neither the active file nor the date
  // actually moved.
  private lastRefreshKey: string | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: DailyInboxPlugin,
  ) {
    super(leaf);
    this.refresher = new DailyInboxRefresher(plugin.sourceSections, (section, state) => {
      const el = this.sectionEls.get(section);
      if (el && this.context) this.renderSection(el, section, state, this.context);
    });
  }

  getViewType(): string { return DAILY_INBOX_VIEW_TYPE; }
  getDisplayText(): string { return "Daily Inbox"; }

  async onOpen(): Promise<void> {
    this.lastRefreshKey = undefined;
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.refresher.cancel();
    this.copyController?.abort();
  }

  /** Forces a re-query even if the active file/date key hasn't changed — used for manual refresh and when source settings or auth state change. */
  async forceRefresh(): Promise<void> {
    this.lastRefreshKey = undefined;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const date = this.dateResolver.resolve(activeFile);
    const key = `${activeFile?.path ?? ""}\0${date ?? ""}`;
    if (key === this.lastRefreshKey) return;
    this.lastRefreshKey = key;

    this.refresher.cancel();
    this.context = date && activeFile ? { date, activeFile } : undefined;
    this.render(date, this.context);
    if (this.context) await this.refresher.refresh(this.context);
  }

  private render(date: LocalDate | undefined, context: DailyContext | undefined): void {
    this.contentEl.empty();
    this.sectionEls.clear();
    this.renderHeader(date);
    if (!date || !context) {
      this.contentEl.createEl("p", { text: "No Daily Note date resolved." });
      this.contentEl.createEl("p", {
        text: "Open a note named YYYY-MM-DD.md to view its Daily Context.",
      });
      return;
    }
    for (const section of this.refresher.sections) {
      this.sectionEls.set(section, this.contentEl.createDiv({ cls: "daily-inbox-source" }));
    }
  }

  // Sidebar leaves don't show the view header, so ItemView.addAction() icons
  // would be invisible there; the refresh button lives in the content instead.
  private renderHeader(date: LocalDate | undefined): void {
    const header = this.contentEl.createDiv({ cls: "daily-inbox-header" });
    header.createEl("h2", { text: date ?? "Daily Inbox" });
    const refresh = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Refresh" } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.forceRefresh());
  }

  private renderSection(
    el: HTMLElement,
    section: SourceSection,
    state: SectionState,
    context: DailyContext,
  ): void {
    el.empty();
    el.createEl("h3", { text: section.source.name });

    if (state.kind === "unavailable") {
      el.createEl("p", { text: state.message, cls: "daily-inbox-empty" });
      return;
    }
    if (state.kind === "loading") {
      el.createEl("p", { text: "Loading…", cls: "daily-inbox-empty" });
      return;
    }
    if (state.kind === "error") {
      el.createEl("p", { text: state.message, cls: "daily-inbox-error" });
      return;
    }
    if (state.items.length === 0) {
      el.createEl("p", { text: section.emptyMessage, cls: "daily-inbox-empty" });
      return;
    }
    const { images, others } = partitionItems(state.items);
    if (images.length > 0) this.renderImageGrid(el, images, context);
    if (others.length > 0) this.renderItemList(el, others);
  }

  private renderImageGrid(el: HTMLElement, items: ContextItem[], context: DailyContext): void {
    const grid = el.createDiv({ cls: "daily-inbox-photo-grid" });
    for (const item of items) {
      const cell = grid.createDiv({ cls: "daily-inbox-photo" });
      const label = item.title ?? item.id;
      const tooltip = item.subtitle ? `${label} · ${item.subtitle}` : label;
      cell.setAttr("title", tooltip);
      if (this.plugin.copyImageAction.canHandle(item)) {
        cell.addClass("is-copyable");
        cell.setAttr("role", "button");
        cell.setAttr("tabindex", "0");
        cell.setAttr("aria-label", `Copy ${label} to the clipboard`);
        cell.addEventListener("click", () => this.copyItem(item, context));
        cell.addEventListener("keydown", (evt) => {
          if (evt.key !== "Enter" && evt.key !== " ") return;
          evt.preventDefault();
          this.copyItem(item, context);
        });
      }
      if (item.thumbnail) {
        const img = cell.createEl("img", { cls: "daily-inbox-photo-thumb" });
        img.src = item.thumbnail;
        img.alt = label;
        img.loading = "lazy";
      } else {
        cell.createDiv({ cls: "daily-inbox-photo-fallback", text: "No preview" });
      }
      if (item.subtitle) {
        cell.createDiv({ cls: "daily-inbox-photo-caption", text: item.subtitle });
      }
    }
  }

  private renderItemList(el: HTMLElement, items: ContextItem[]): void {
    const list = el.createEl("ul", { cls: "daily-inbox-item-list" });
    for (const item of items) {
      const entry = list.createEl("li", { cls: "daily-inbox-item" });
      entry.createDiv({ cls: "daily-inbox-item-title", text: item.title ?? item.id });
      if (item.subtitle) entry.createDiv({ cls: "daily-inbox-item-subtitle", text: item.subtitle });
    }
  }

  // Must stay synchronous up to action.run(): the clipboard write has to start
  // inside the click/keydown's user activation.
  private copyItem(item: ContextItem, context: DailyContext): void {
    this.copyController?.abort();
    const controller = new AbortController();
    this.copyController = controller;
    const progress = new Notice("Copying photo…", 0);
    this.plugin.copyImageAction.run(item, context, controller.signal).then(
      () => {
        progress.hide();
        if (controller.signal.aborted) return;
        new Notice("Photo copied. Paste it into your note.");
      },
      (err: unknown) => {
        progress.hide();
        if (err instanceof CancelledError || controller.signal.aborted) return;
        console.error("Daily Inbox: failed to copy photo", err);
        new Notice(describeCopyError(err));
      },
    );
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
    renderDropboxSettings(this.containerEl, this, () => {
      this.plugin.refreshAllViews();
      this.display();
    });
  }
}

export default class DailyInboxPlugin extends Plugin {
  data: DailyInboxPluginData = { dropbox: { ...DEFAULT_DROPBOX_SETTINGS } };
  dropboxAuth!: DropboxAuthManager;
  dropboxSource!: DropboxSource;
  copyImageAction!: CopyImageToClipboardAction;
  sourceSections!: SourceSection[];

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
    const dropboxSource = this.dropboxSource;
    this.sourceSections = [
      {
        source: dropboxSource,
        emptyMessage: "No photos for this date.",
        describeUnavailable: () =>
          describeDropboxUnavailable(getDropboxSetupStatus(this.data.dropbox, this.dropboxAuth)),
        describeError: describeDropboxError,
      },
    ];
    this.copyImageAction = new CopyImageToClipboardAction(
      {
        canFetch: (item) => item.sourceId === dropboxSource.id,
        fetchOriginal: (item, signal) =>
          dropboxSource.downloadOriginal(item.payload as DropboxImagePayload, signal),
      },
      getBrowserImageClipboard,
      encodePngWithCanvas,
    );

    this.registerView(DAILY_INBOX_VIEW_TYPE, (leaf) => new DailyInboxView(leaf, this));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.forEachView((view) => void view.refresh());
    }));
    this.addCommand({
      id: "open-daily-inbox",
      name: "Open Daily Inbox",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "refresh-daily-inbox",
      name: "Refresh Daily Inbox",
      callback: () => this.refreshAllViews(),
    });
    this.addSettingTab(new DailyInboxSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(DAILY_INBOX_VIEW_TYPE);
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }

  /** Forces every open Daily Inbox view to re-query its sources, e.g. after Dropbox settings or auth state change. */
  refreshAllViews(): void {
    this.forEachView((view) => void view.forceRefresh());
  }

  private forEachView(fn: (view: DailyInboxView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DAILY_INBOX_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof DailyInboxView) fn(view);
    }
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DAILY_INBOX_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: DAILY_INBOX_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
