import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";
import { FileNameDateResolver } from "./domain";
import type { DailyContext, LocalDate } from "./domain";

export * from "./domain";

export const DAILY_INBOX_VIEW_TYPE = "daily-inbox-view";

class DailyInboxView extends ItemView {
  private readonly dateResolver = new FileNameDateResolver();
  private refreshController?: AbortController;
  private refreshSequence = 0;

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

    // Keep an async boundary so future source requests share this cancellation guard.
    await Promise.resolve();
    if (controller.signal.aborted || sequence !== this.refreshSequence) return;
    this.render(date, date && activeFile ? { date, activeFile } : undefined);
  }

  private render(date: LocalDate | undefined, context: DailyContext | undefined): void {
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
    this.contentEl.createEl("p", {
      text: "No context sources are configured yet.",
      cls: "daily-inbox-empty",
    });
  }
}

export default class DailyInboxPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(DAILY_INBOX_VIEW_TYPE, (leaf) => new DailyInboxView(leaf));
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
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(DAILY_INBOX_VIEW_TYPE);
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DAILY_INBOX_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: DAILY_INBOX_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
