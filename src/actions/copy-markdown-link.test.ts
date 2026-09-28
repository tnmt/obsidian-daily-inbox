import { describe, expect, it } from "vitest";
import type { ContextItem, DailyContext } from "../domain";
import { localDate } from "../domain";
import { ClipboardUnsupportedError } from "./errors";
import { CopyMarkdownLinkAction, type TextClipboard } from "./copy-markdown-link";

const context: DailyContext = { date: localDate("2026-09-23") };

function item(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "id:1",
    sourceId: "browser-history:1",
    type: "link",
    payload: { url: "https://example.com/page" },
    ...overrides,
  };
}

function recordingClipboard(): TextClipboard & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    writeText: async (text) => {
      written.push(text);
    },
  };
}

describe("CopyMarkdownLinkAction", () => {
  it("handles link items regardless of sourceId", () => {
    const action = new CopyMarkdownLinkAction(() => undefined);
    expect(action.canHandle(item())).toBe(true);
    expect(action.canHandle(item({ sourceId: "other" }))).toBe(true);
    expect(action.canHandle(item({ type: "image" }))).toBe(false);
  });

  it("writes a Markdown link using the item's title and payload url", async () => {
    const clipboard = recordingClipboard();
    const action = new CopyMarkdownLinkAction(() => clipboard);
    await action.run(item({ title: "Example Page" }), context, new AbortController().signal);
    expect(clipboard.written).toEqual(["[Example Page](https://example.com/page)"]);
  });

  it("falls back to the URL as the title when none is set", async () => {
    const clipboard = recordingClipboard();
    const action = new CopyMarkdownLinkAction(() => clipboard);
    await action.run(item({ title: undefined }), context, new AbortController().signal);
    expect(clipboard.written).toEqual(["[https://example.com/page](https://example.com/page)"]);
  });

  it("escapes square brackets in the title so the link isn't truncated", async () => {
    const clipboard = recordingClipboard();
    const action = new CopyMarkdownLinkAction(() => clipboard);
    await action.run(item({ title: "[BUG] Reference [1]" }), context, new AbortController().signal);
    expect(clipboard.written).toEqual(["[\\[BUG\\] Reference \\[1\\]](https://example.com/page)"]);
  });

  it("percent-encodes parentheses in the URL so the destination isn't truncated", async () => {
    const clipboard = recordingClipboard();
    const action = new CopyMarkdownLinkAction(() => clipboard);
    await action.run(
      item({ title: "Wiki", payload: { url: "https://example.com/wiki/Foo_(bar)" } }),
      context,
      new AbortController().signal,
    );
    expect(clipboard.written).toEqual(["[Wiki](https://example.com/wiki/Foo_%28bar%29)"]);
  });

  it("rejects with ClipboardUnsupportedError when the clipboard is unsupported", async () => {
    const action = new CopyMarkdownLinkAction(() => undefined);
    await expect(action.run(item(), context, new AbortController().signal)).rejects.toThrow(
      ClipboardUnsupportedError,
    );
  });
});
