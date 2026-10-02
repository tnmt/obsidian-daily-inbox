import type { ContextAction, ContextItem, DailyContext } from "../domain";
import type { TextClipboard } from "./copy-markdown-link";
import { ClipboardUnsupportedError } from "./errors";

/** Ready-to-paste Markdown text the source prepared for an activity item. */
export interface ActivityTextPayload {
  readonly text: string;
}

function hasActivityText(payload: unknown): payload is ActivityTextPayload {
  return typeof payload === "object" && payload !== null && typeof (payload as ActivityTextPayload).text === "string";
}

// Matched by item type plus payload shape, so any activity-typed source that
// prepares a text line gets this action without the view knowing about it.
export class CopyActivityTextAction implements ContextAction {
  readonly id = "copy-activity-text";

  constructor(private readonly getClipboard: () => TextClipboard | undefined) {}

  canHandle(item: ContextItem): boolean {
    return item.type === "activity" && hasActivityText(item.payload);
  }

  async run(item: ContextItem, _context: DailyContext, _signal: AbortSignal): Promise<void> {
    const clipboard = this.getClipboard();
    if (!clipboard) throw new ClipboardUnsupportedError();
    await clipboard.writeText((item.payload as ActivityTextPayload).text);
  }
}
