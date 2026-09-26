import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";

export const DAILY_INBOX_VIEW_TYPE = "daily-inbox-view";

class DailyInboxView extends ItemView {
  getViewType(): string {
    return DAILY_INBOX_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Daily Inbox";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Daily Inbox" });
    this.contentEl.createEl("p", {
      text: "Daily Context will appear here.",
    });
  }
}

export default class DailyInboxPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      DAILY_INBOX_VIEW_TYPE,
      (leaf) => new DailyInboxView(leaf),
    );

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

    if (!leaf) {
      return;
    }

    await leaf.setViewState({
      type: DAILY_INBOX_VIEW_TYPE,
      active: true,
    });

    this.app.workspace.revealLeaf(leaf);
  }
}
