import { readFile } from "fs/promises";
import { homedir } from "os";
import {
  ItemView,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  TFile,
  WorkspaceLeaf,
  requestUrl,
  setIcon,
} from "obsidian";
import type { App } from "obsidian";
import { ClipboardUnsupportedError } from "./actions/errors";
import {
  CopyImageToClipboardAction,
  ImageDecodeError,
  encodePngWithCanvas,
  getBrowserImageClipboard,
} from "./actions/copy-image-to-clipboard";
import { CopyActivityTextAction } from "./actions/copy-activity-text";
import { CopyMarkdownLinkAction, getBrowserTextClipboard } from "./actions/copy-markdown-link";
import { OpenNoteAction } from "./actions/open-note";
import { SingleOriginalImageCache } from "./actions/original-image-cache";
import type { NoteOpener } from "./actions/open-note";
import { DailyInboxRefresher, partitionItems } from "./daily-inbox-refresh";
import type { SectionState, SourceSection } from "./daily-inbox-refresh";
import { FileNameDateResolver } from "./domain";
import { ImagePreviewModal } from "./image-preview-modal";
import type { ContextAction, ContextItem, DailyContext, LocalDate } from "./domain";
import { DropboxAuthManager } from "./sources/dropbox/auth";
import type { DropboxAuthPersistence, DropboxTokens } from "./sources/dropbox/auth";
import { CancelledError } from "./sources/dropbox/cancel";
import { DropboxSource } from "./sources/dropbox/dropbox-source";
import type { DropboxImagePayload } from "./sources/dropbox/dropbox-source";
import { DropboxSourceError } from "./sources/dropbox/errors";
import { DEFAULT_DROPBOX_SETTINGS, migrateDropboxSettings } from "./sources/dropbox/settings";
import type { DropboxSettings } from "./sources/dropbox/settings";
import { renderDropboxSettings } from "./sources/dropbox/settings-tab";
import type { DropboxSettingsHost } from "./sources/dropbox/settings-tab";
import { getDropboxSetupStatus } from "./sources/dropbox/setup-status";
import type { DropboxSetupStatus } from "./sources/dropbox/setup-status";
import { ChromiumHistorySource } from "./sources/browser-history/browser-history-source";
import type { ChromiumBrowser, SupportedOs } from "./sources/browser-history/browser-paths";
import { localStatePath } from "./sources/browser-history/browser-paths";
import { BrowserHistorySourceError } from "./sources/browser-history/errors";
import { createNodeHistoryDbRuntime } from "./sources/browser-history/history-db";
import type { HistoryDbRuntime } from "./sources/browser-history/history-db";
import { parseLocalStateProfiles } from "./sources/browser-history/local-state";
import type { DetectedProfile } from "./sources/browser-history/local-state";
import { DEFAULT_BROWSER_HISTORY_SETTINGS, resolveHistoryPath } from "./sources/browser-history/settings";
import type { BrowserHistorySettings } from "./sources/browser-history/settings";
import { renderBrowserHistorySettings } from "./sources/browser-history/settings-tab";
import type { BrowserHistorySettingsHost } from "./sources/browser-history/settings-tab";
import { OnThisDaySource } from "./sources/on-this-day/on-this-day-source";
import { DEFAULT_ON_THIS_DAY_SETTINGS } from "./sources/on-this-day/settings";
import type { OnThisDaySettings } from "./sources/on-this-day/settings";
import { renderOnThisDaySettings } from "./sources/on-this-day/settings-tab";
import type { OnThisDaySettingsHost } from "./sources/on-this-day/settings-tab";
import type { VaultAccess } from "./sources/on-this-day/vault-access";
import { LocationSourceError } from "./sources/location/errors";
import { LocationSource } from "./sources/location/location-source";
import { DEFAULT_LOCATION_SETTINGS } from "./sources/location/settings";
import type { LocationSettings } from "./sources/location/settings";
import { renderLocationSettings } from "./sources/location/settings-tab";
import type { LocationSettingsHost } from "./sources/location/settings-tab";
import { GitHubSourceError } from "./sources/github/errors";
import { GitHubSource } from "./sources/github/github-source";
import { DEFAULT_GITHUB_SETTINGS } from "./sources/github/settings";
import type { GitHubSettings } from "./sources/github/settings";
import { renderGitHubSettings } from "./sources/github/settings-tab";
import type { GitHubSettingsHost } from "./sources/github/settings-tab";
import { WithingsAuthManager } from "./sources/withings/auth";
import type { WithingsAuthPersistence, WithingsTokens } from "./sources/withings/auth";
import { WithingsSourceError } from "./sources/withings/errors";
import { DEFAULT_WITHINGS_SETTINGS } from "./sources/withings/settings";
import type { WithingsSettings } from "./sources/withings/settings";
import { renderWithingsSettings } from "./sources/withings/settings-tab";
import type { WithingsSettingsHost } from "./sources/withings/settings-tab";
import { WithingsSource } from "./sources/withings/withings-source";

export * from "./domain";

export const DAILY_INBOX_VIEW_TYPE = "daily-inbox-view";

interface DailyInboxPluginData {
  dropbox: DropboxSettings;
  dropboxTokens?: DropboxTokens;
  browserHistory: BrowserHistorySettings;
  onThisDay: OnThisDaySettings;
  location: LocationSettings;
  github: GitHubSettings;
  withings: WithingsSettings;
  withingsTokens?: WithingsTokens;
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

function describeCopyImageError(err: unknown): string {
  if (err instanceof DropboxSourceError) return describeDropboxError(err);
  if (err instanceof ClipboardUnsupportedError) return err.message;
  if (err instanceof ImageDecodeError) return "This photo's format cannot be copied to the clipboard.";
  return "Could not copy the photo to the clipboard.";
}

function describeCopyMarkdownLinkError(err: unknown): string {
  if (err instanceof ClipboardUnsupportedError) return err.message;
  return "Could not copy the link to the clipboard.";
}

function describeOpenNoteError(): string {
  return "Could not open that note.";
}

function describeLocationError(err: unknown): string {
  if (err instanceof LocationSourceError) {
    switch (err.kind) {
      case "auth-required":
        return "The location server rejected the read token. Check it in Settings → Daily Inbox.";
      case "not-found":
        return "No location API at the configured server URL. Check it in Settings → Daily Inbox.";
      case "transient":
        return "Could not reach the location server. Try refreshing.";
      case "malformed":
        return "The location server returned unexpected data.";
    }
  }
  return "Unexpected error while querying the location server.";
}

function describeGitHubError(err: unknown): string {
  if (err instanceof GitHubSourceError) {
    switch (err.kind) {
      case "auth-required":
        return "GitHub rejected the access token. Check it in Settings → Daily Inbox.";
      case "invalid-user":
        return "GitHub could not search the configured username. Check it in Settings → Daily Inbox.";
      case "rate-limited":
        return "GitHub search rate limit reached. Try again in a minute.";
      case "incomplete":
        return "GitHub search timed out with partial results. Try refreshing.";
      case "transient":
        return "Could not reach GitHub. Try refreshing.";
      case "malformed":
        return "GitHub returned unexpected data.";
    }
  }
  return "Unexpected error while querying GitHub.";
}

function describeWithingsError(err: unknown): string {
  if (err instanceof WithingsSourceError) {
    switch (err.kind) {
      case "auth-required":
        return "Withings re-authentication is required. Reconnect it in Settings → Daily Inbox.";
      case "rate-limited":
        return "Withings allows one request per 10 minutes. Try again later.";
      case "transient":
        return "Could not reach Withings. Try refreshing.";
      case "malformed":
        return "Withings returned unexpected data.";
    }
  }
  return "Unexpected error while querying Withings.";
}

function describeCopyActivityTextError(err: unknown): string {
  if (err instanceof ClipboardUnsupportedError) return err.message;
  return "Could not copy the text to the clipboard.";
}

function describeOnThisDayError(): string {
  return "Unexpected error while looking up past Daily Notes.";
}

function describeBrowserHistoryError(err: unknown): string {
  if (err instanceof BrowserHistorySourceError) {
    switch (err.kind) {
      case "sqlite3-missing":
        return "The sqlite3 command-line tool was not found. Install it or check your PATH.";
      case "unreadable":
        return "Could not read this browser's History file.";
      case "malformed":
        return "Unexpected data was returned while reading browser history.";
    }
  }
  return "Unexpected error while reading browser history.";
}

function describeBrowserHistoryUnavailable(): string {
  return "No History file found for this profile. Check the path in Settings → Daily Inbox.";
}

// Default profile-path detection covers macOS and Linux (this plugin's two
// supported desktop platforms, see docs/architecture.md's "Supported
// platforms"). Anything else falls back to Linux-shaped paths, which will
// simply not resolve — same net effect as before this distinction existed —
// leaving the settings tab's custom path field as the way to configure it.
function currentOs(): SupportedOs {
  return Platform.isMacOS ? "macos" : "linux";
}

class DailyInboxView extends ItemView {
  private readonly dateResolver = new FileNameDateResolver();
  private refresher!: DailyInboxRefresher;
  private readonly sectionEls = new Map<SourceSection, HTMLElement>();
  private context: DailyContext | undefined;
  private copyController?: AbortController;
  private previewModal?: ImagePreviewModal;
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
  }

  getViewType(): string { return DAILY_INBOX_VIEW_TYPE; }
  getDisplayText(): string { return "Daily Inbox"; }

  async onOpen(): Promise<void> {
    this.lastRefreshKey = undefined;
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.refresher?.cancel();
    this.copyController?.abort();
    this.previewModal?.close();
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

    this.refresher?.cancel();
    // Rebuilt fresh each refresh (cheap: just wraps arrays), rather than once
    // in the constructor, so a source list that changed in settings (e.g. a
    // browser-history profile added/removed) is picked up without needing to
    // detach/reopen this view.
    this.refresher = new DailyInboxRefresher(this.plugin.sourceSections, (section, state) => {
      const el = this.sectionEls.get(section);
      if (el && this.context) this.renderSection(el, section, state, this.context);
    });
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
    } else {
      const { images, others } = partitionItems(state.items);
      if (images.length > 0) this.renderImageGrid(el, images, context);
      if (others.length > 0) this.renderItemList(el, others, context);
    }
    if (section.note) el.createEl("p", { text: section.note, cls: "daily-inbox-note" });
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
        cell.setAttr("aria-label", `Preview ${label}`);
        cell.addEventListener("click", () => this.openPreview(item, context));
        cell.addEventListener("keydown", (evt) => {
          if (evt.key !== "Enter" && evt.key !== " ") return;
          evt.preventDefault();
          this.openPreview(item, context);
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

  private renderItemList(el: HTMLElement, items: ContextItem[], context: DailyContext): void {
    const list = el.createEl("ul", { cls: "daily-inbox-item-list" });
    let lastGroupLabel: string | undefined;
    for (const item of items) {
      // Items arrive pre-sorted by their source, so a boundary is drawn
      // whenever the group changes rather than by re-sorting/grouping here.
      if (item.groupLabel !== undefined && item.groupLabel !== lastGroupLabel) {
        list.createEl("li", { cls: "daily-inbox-group-label", text: item.groupLabel });
        lastGroupLabel = item.groupLabel;
      }
      const entry = list.createEl("li", { cls: ["daily-inbox-item", `is-${item.type}`] });
      const label = item.title ?? item.id;
      const handler = this.resolveItemHandler(item);
      if (handler) {
        entry.addClass("is-copyable");
        entry.setAttr("role", "button");
        entry.setAttr("tabindex", "0");
        entry.setAttr("aria-label", handler.ariaLabel(label));
        entry.addEventListener("click", () => handler.run(item, context));
        entry.addEventListener("keydown", (evt) => {
          if (evt.key !== "Enter" && evt.key !== " ") return;
          evt.preventDefault();
          handler.run(item, context);
        });
      }
      entry.createDiv({ cls: "daily-inbox-item-title", text: label });
      if (item.subtitle) entry.createDiv({ cls: "daily-inbox-item-subtitle", text: item.subtitle });
    }
  }

  // Each item type in the list is handled by exactly one action; new
  // note/link-typed sources get list interactivity for free by matching an
  // existing action's canHandle(), without this view knowing about sources.
  private resolveItemHandler(
    item: ContextItem,
  ): { ariaLabel: (label: string) => string; run: (item: ContextItem, context: DailyContext) => void } | undefined {
    if (this.plugin.copyMarkdownLinkAction.canHandle(item)) {
      return {
        ariaLabel: (label) => `Copy ${label} as a Markdown link`,
        run: (item, context) => this.copyMarkdownLink(item, context),
      };
    }
    if (this.plugin.copyActivityTextAction.canHandle(item)) {
      return {
        ariaLabel: (label) => `Copy ${label} as text`,
        run: (item, context) => this.copyActivityText(item, context),
      };
    }
    if (this.plugin.openNoteAction.canHandle(item)) {
      return {
        ariaLabel: (label) => `Open ${label}`,
        run: (item, context) => this.openNote(item, context),
      };
    }
    return undefined;
  }

  private openPreview(item: ContextItem, context: DailyContext): void {
    this.previewModal?.close();
    const modal = new ImagePreviewModal(this.app, item, this.plugin.originalImageCache, () =>
      this.copyImage(item, context),
    );
    this.previewModal = modal;
    modal.open();
  }

  private copyImage(item: ContextItem, context: DailyContext): void {
    this.runAction(this.plugin.copyImageAction, item, context, {
      progressText: "Copying photo…",
      successText: "Photo copied. Paste it into your note.",
      describeError: describeCopyImageError,
    });
  }

  private copyMarkdownLink(item: ContextItem, context: DailyContext): void {
    this.runAction(this.plugin.copyMarkdownLinkAction, item, context, {
      progressText: "Copying link…",
      successText: "Link copied. Paste it into your note.",
      describeError: describeCopyMarkdownLinkError,
    });
  }

  private copyActivityText(item: ContextItem, context: DailyContext): void {
    this.runAction(this.plugin.copyActivityTextAction, item, context, {
      progressText: "Copying…",
      successText: "Copied. Paste it into your note.",
      describeError: describeCopyActivityTextError,
    });
  }

  private openNote(item: ContextItem, context: DailyContext): void {
    this.runAction(this.plugin.openNoteAction, item, context, {
      progressText: "Opening note…",
      successText: "Note opened.",
      describeError: describeOpenNoteError,
    });
  }

  // Must stay synchronous up to action.run(): the clipboard write has to start
  // inside the click/keydown's user activation.
  private runAction(
    action: ContextAction,
    item: ContextItem,
    context: DailyContext,
    opts: { progressText: string; successText: string; describeError: (err: unknown) => string },
  ): void {
    this.copyController?.abort();
    const controller = new AbortController();
    this.copyController = controller;
    const progress = new Notice(opts.progressText, 0);
    action.run(item, context, controller.signal).then(
      () => {
        progress.hide();
        if (controller.signal.aborted) return;
        new Notice(opts.successText);
      },
      (err: unknown) => {
        progress.hide();
        if (err instanceof CancelledError || controller.signal.aborted) return;
        console.error("Daily Inbox: action failed", err);
        new Notice(opts.describeError(err));
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

  private get browserHistoryHost(): BrowserHistorySettingsHost {
    return {
      settings: this.plugin.data.browserHistory,
      saveSettings: () => this.plugin.savePluginData(),
      detectProfiles: (browser) => this.plugin.detectBrowserProfiles(browser),
      resolvePath: (profile) => resolveHistoryPath(profile, homedir(), currentOs()),
    };
  }

  private get onThisDayHost(): OnThisDaySettingsHost {
    return {
      settings: this.plugin.data.onThisDay,
      saveSettings: () => this.plugin.savePluginData(),
    };
  }

  private get withingsHost(): WithingsSettingsHost {
    return {
      settings: this.plugin.data.withings,
      auth: this.plugin.withingsAuth,
      saveSettings: () => this.plugin.savePluginData(),
    };
  }

  private get githubHost(): GitHubSettingsHost {
    return {
      settings: this.plugin.data.github,
      saveSettings: () => this.plugin.savePluginData(),
    };
  }

  private get locationHost(): LocationSettingsHost {
    return {
      settings: this.plugin.data.location,
      saveSettings: () => this.plugin.savePluginData(),
    };
  }

  display(): void {
    this.containerEl.empty();
    renderDropboxSettings(this.containerEl, this, () => {
      this.plugin.refreshAllViews();
      this.display();
    });
    renderLocationSettings(this.containerEl, this.locationHost, () => {
      this.plugin.refreshAllViews();
      this.display();
    });
    renderGitHubSettings(this.containerEl, this.githubHost, () => {
      this.plugin.refreshAllViews();
      this.display();
    });
    renderWithingsSettings(this.containerEl, this.withingsHost, () => {
      this.plugin.refreshAllViews();
      this.display();
    });
    renderBrowserHistorySettings(this.containerEl, this.browserHistoryHost, () => {
      this.plugin.rebuildSourceSections();
      this.plugin.refreshAllViews();
      this.display();
    });
    renderOnThisDaySettings(this.containerEl, this.onThisDayHost, () => {
      this.plugin.refreshAllViews();
      this.display();
    });
  }
}

export default class DailyInboxPlugin extends Plugin {
  data: DailyInboxPluginData = {
    dropbox: { ...DEFAULT_DROPBOX_SETTINGS },
    browserHistory: { ...DEFAULT_BROWSER_HISTORY_SETTINGS },
    onThisDay: { ...DEFAULT_ON_THIS_DAY_SETTINGS },
    location: { ...DEFAULT_LOCATION_SETTINGS },
    github: { ...DEFAULT_GITHUB_SETTINGS },
    withings: { ...DEFAULT_WITHINGS_SETTINGS },
  };
  dropboxAuth!: DropboxAuthManager;
  withingsAuth!: WithingsAuthManager;
  withingsSource!: WithingsSource;
  dropboxSource!: DropboxSource;
  originalImageCache!: SingleOriginalImageCache;
  copyImageAction!: CopyImageToClipboardAction;
  copyMarkdownLinkAction!: CopyMarkdownLinkAction;
  copyActivityTextAction!: CopyActivityTextAction;
  openNoteAction!: OpenNoteAction;
  sourceSections!: SourceSection[];
  private historyDbRuntime!: HistoryDbRuntime;

  async onload(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<DailyInboxPluginData> | null;
    this.data = {
      dropbox: { ...DEFAULT_DROPBOX_SETTINGS, ...migrateDropboxSettings(loaded?.dropbox) },
      dropboxTokens: loaded?.dropboxTokens,
      browserHistory: { ...DEFAULT_BROWSER_HISTORY_SETTINGS, ...loaded?.browserHistory },
      onThisDay: { ...DEFAULT_ON_THIS_DAY_SETTINGS, ...loaded?.onThisDay },
      location: { ...DEFAULT_LOCATION_SETTINGS, ...loaded?.location },
      github: { ...DEFAULT_GITHUB_SETTINGS, ...loaded?.github },
      withings: { ...DEFAULT_WITHINGS_SETTINGS, ...loaded?.withings },
      withingsTokens: loaded?.withingsTokens,
    };

    const persistence: DropboxAuthPersistence = {
      load: () => this.data.dropboxTokens,
      save: async (tokens) => {
        this.data.dropboxTokens = tokens;
        await this.savePluginData();
      },
    };
    this.dropboxAuth = new DropboxAuthManager(requestUrl, () => this.data.dropbox.clientId, persistence);
    this.dropboxSource = new DropboxSource(requestUrl, this.dropboxAuth, () => this.data.dropbox.folderPaths);
    const withingsPersistence: WithingsAuthPersistence = {
      load: () => this.data.withingsTokens,
      save: async (tokens) => {
        this.data.withingsTokens = tokens;
        await this.savePluginData();
      },
    };
    this.withingsAuth = new WithingsAuthManager(requestUrl, () => this.data.withings, withingsPersistence);
    this.withingsSource = new WithingsSource(requestUrl, this.withingsAuth);
    this.historyDbRuntime = createNodeHistoryDbRuntime();
    this.rebuildSourceSections();

    const dropboxSource = this.dropboxSource;
    // Shared by the preview and the copy action so that copying from the
    // preview reuses the original it already downloaded.
    this.originalImageCache = new SingleOriginalImageCache({
      canFetch: (item) => item.sourceId === dropboxSource.id,
      fetchOriginal: (item, signal) =>
        dropboxSource.downloadOriginal(item.payload as DropboxImagePayload, signal),
    });
    this.copyImageAction = new CopyImageToClipboardAction(
      this.originalImageCache,
      getBrowserImageClipboard,
      encodePngWithCanvas,
    );
    this.copyMarkdownLinkAction = new CopyMarkdownLinkAction(getBrowserTextClipboard);
    this.copyActivityTextAction = new CopyActivityTextAction(getBrowserTextClipboard);
    const noteOpener: NoteOpener = {
      open: async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error("Note not found.");
        // getLeaf(false) would reuse the Daily Inbox sidebar leaf itself
        // (clicking inside it makes it the active leaf), replacing the panel
        // instead of opening the note in the main editor area.
        const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit) ?? this.app.workspace.getLeaf(true);
        // active: true reactivates the main leaf even though the click left
        // focus on the sidebar, so active-leaf-change/file-open fire and the
        // Daily Inbox re-queries against the newly opened date.
        await leaf.openFile(file, { active: true });
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
      },
    };
    this.openNoteAction = new OpenNoteAction(noteOpener);

    this.registerView(DAILY_INBOX_VIEW_TYPE, (leaf) => new DailyInboxView(leaf, this));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.forEachView((view) => void view.refresh());
    }));
    // active-leaf-change misses the case where a file is opened into the
    // already-active leaf — e.g. OpenNoteAction reusing the main pane's most
    // recent leaf while focus stays on the sidebar item that was clicked.
    // file-open fires whenever the active file changes and covers that gap.
    this.registerEvent(this.app.workspace.on("file-open", () => {
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
    this.withingsAuth.cancelAuthorization();
    this.app.workspace.detachLeavesOfType(DAILY_INBOX_VIEW_TYPE);
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }

  /** Resolves/reads notes through the real Vault/MetadataCache, kept behind an interface so OnThisDaySource itself needs no Obsidian App to test. */
  private vaultAccess(): VaultAccess {
    return {
      listDailyNoteFileNames: () =>
        this.app.vault.getMarkdownFiles()
          .map((file) => file.name)
          .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)),
      resolveDatedNote: (fileName, sourcePath) => {
        const dest = this.app.metadataCache.getFirstLinkpathDest(fileName.replace(/\.md$/, ""), sourcePath);
        if (!dest || dest.extension !== "md") return undefined;
        return { path: dest.path };
      },
      readNote: (note) => this.app.vault.adapter.read(note.path),
    };
  }

  /** Rebuilds the source/section list from current settings — the number of browser-history sources can change (profiles added/removed), unlike Dropbox's fixed single section. */
  rebuildSourceSections(): void {
    const dropboxSource = this.dropboxSource;
    const sections: SourceSection[] = [
      {
        source: dropboxSource,
        emptyMessage: "No photos for this date.",
        describeUnavailable: () =>
          describeDropboxUnavailable(getDropboxSetupStatus(this.data.dropbox, this.dropboxAuth)),
        describeError: describeDropboxError,
      },
      {
        source: new LocationSource(requestUrl, () => this.data.location),
        emptyMessage: "No location data for this date.",
        describeUnavailable: () =>
          "Location is not configured. Set the server URL and read token in Settings → Daily Inbox.",
        describeError: describeLocationError,
      },
      {
        source: new GitHubSource(requestUrl, () => this.data.github),
        emptyMessage: "No GitHub activity for this date.",
        note: "Commit search covers only each repository's default branch; commits on other branches are not shown.",
        describeUnavailable: () =>
          "GitHub is not configured. Set the username and access token in Settings → Daily Inbox.",
        describeError: describeGitHubError,
      },
      {
        source: this.withingsSource,
        emptyMessage: "No measurements for this date.",
        describeUnavailable: () => "Withings is not connected. Connect it in Settings → Daily Inbox.",
        describeError: describeWithingsError,
      },
      {
        source: new OnThisDaySource(
          {
            id: "on-this-day",
            name: "On this day",
            getExcerptHeading: () => this.data.onThisDay.excerptHeading,
          },
          this.vaultAccess(),
        ),
        emptyMessage: "No Daily Notes from other years on this date.",
        describeUnavailable: () => "On this day is unavailable.",
        describeError: describeOnThisDayError,
      },
    ];
    for (const profile of this.data.browserHistory.profiles) {
      const source = new ChromiumHistorySource(
        {
          id: `browser-history:${profile.configId}`,
          name: profile.label,
          getHistoryPath: () => resolveHistoryPath(profile, homedir(), currentOs()),
          getExcludedDomains: () => profile.excludedDomains,
        },
        this.historyDbRuntime,
        () => Platform.isDesktopApp,
      );
      sections.push({
        source,
        emptyMessage: "No pages visited on this date.",
        describeUnavailable: describeBrowserHistoryUnavailable,
        describeError: describeBrowserHistoryError,
      });
    }
    this.sourceSections = sections;
  }

  async detectBrowserProfiles(browser: ChromiumBrowser): Promise<DetectedProfile[]> {
    try {
      const text = await readFile(localStatePath(browser, homedir(), currentOs()), "utf8");
      return parseLocalStateProfiles(text);
    } catch {
      return [];
    }
  }

  /** Forces every open Daily Inbox view to re-query its sources, e.g. after settings or auth state change. */
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
