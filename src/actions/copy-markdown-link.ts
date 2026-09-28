import type { ContextAction, ContextItem, DailyContext } from "../domain";
import { ClipboardUnsupportedError } from "./errors";

export interface LinkPayload {
  readonly url: string;
}

export interface TextClipboard {
  writeText(text: string): Promise<void>;
}

// Page titles are arbitrary text and commonly contain "[" / "]" (e.g. "[BUG]
// ...", "Reference [1]"), which would otherwise terminate the link text early.
function escapeMarkdownLinkText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/[\r\n]+/g, " ");
}

// "(" / ")" would otherwise terminate the URL early; percent-encoding is
// valid inside a Markdown link destination and round-trips correctly.
function escapeMarkdownLinkUrl(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

// Matched by item type, not sourceId, so any future link-typed source gets
// this action for free.
export class CopyMarkdownLinkAction implements ContextAction {
  readonly id = "copy-markdown-link";

  constructor(private readonly getClipboard: () => TextClipboard | undefined) {}

  canHandle(item: ContextItem): boolean {
    return item.type === "link";
  }

  async run(item: ContextItem, _context: DailyContext, _signal: AbortSignal): Promise<void> {
    const clipboard = this.getClipboard();
    if (!clipboard) throw new ClipboardUnsupportedError();
    const { url } = item.payload as LinkPayload;
    const title = escapeMarkdownLinkText(item.title ?? url);
    await clipboard.writeText(`[${title}](${escapeMarkdownLinkUrl(url)})`);
  }
}

export function getBrowserTextClipboard(): TextClipboard | undefined {
  if (typeof navigator?.clipboard?.writeText !== "function") return undefined;
  return { writeText: (text) => navigator.clipboard.writeText(text) };
}
