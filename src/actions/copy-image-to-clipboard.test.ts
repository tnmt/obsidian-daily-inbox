import { describe, expect, it, vi } from "vitest";
import type { ContextItem, DailyContext } from "../domain";
import { localDate } from "../domain";
import {
  ClipboardUnsupportedError,
  CopyImageToClipboardAction,
  isPng,
  type ImageClipboard,
  type OriginalImageFetcher,
} from "./copy-image-to-clipboard";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).buffer;
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;

const context: DailyContext = { date: localDate("2026-09-23") };

function item(overrides: Partial<ContextItem> = {}): ContextItem {
  return { id: "id:1", sourceId: "dropbox", type: "image", payload: {}, ...overrides };
}

function fetcher(result: Promise<ArrayBuffer>): OriginalImageFetcher {
  return { canFetch: (i) => i.sourceId === "dropbox", fetchOriginal: vi.fn(() => result) };
}

function recordingClipboard(): ImageClipboard & { written: Blob[] } {
  const written: Blob[] = [];
  return {
    written,
    writePng: async (png) => {
      written.push(await png);
    },
  };
}

describe("isPng", () => {
  it("detects the PNG signature", () => {
    expect(isPng(PNG_BYTES)).toBe(true);
    expect(isPng(JPEG_BYTES)).toBe(false);
    expect(isPng(new ArrayBuffer(0))).toBe(false);
  });
});

describe("CopyImageToClipboardAction", () => {
  it("handles only image items its fetcher can download", () => {
    const action = new CopyImageToClipboardAction(fetcher(Promise.resolve(PNG_BYTES)), () => undefined, vi.fn());
    expect(action.canHandle(item())).toBe(true);
    expect(action.canHandle(item({ type: "note" }))).toBe(false);
    expect(action.canHandle(item({ sourceId: "other" }))).toBe(false);
  });

  it("writes PNG originals without re-encoding", async () => {
    const clipboard = recordingClipboard();
    const encode = vi.fn();
    const action = new CopyImageToClipboardAction(fetcher(Promise.resolve(PNG_BYTES)), () => clipboard, encode);
    await action.run(item(), context, new AbortController().signal);
    expect(encode).not.toHaveBeenCalled();
    expect(clipboard.written).toHaveLength(1);
    expect(clipboard.written[0].type).toBe("image/png");
  });

  it("re-encodes non-PNG originals to PNG", async () => {
    const clipboard = recordingClipboard();
    const encoded = new Blob(["png"], { type: "image/png" });
    const encode = vi.fn(async () => encoded);
    const action = new CopyImageToClipboardAction(fetcher(Promise.resolve(JPEG_BYTES)), () => clipboard, encode);
    await action.run(item(), context, new AbortController().signal);
    expect(encode).toHaveBeenCalledOnce();
    expect(clipboard.written).toEqual([encoded]);
  });

  it("calls the clipboard before the download resolves", () => {
    const writePng = vi.fn(() => new Promise<void>(() => undefined));
    const action = new CopyImageToClipboardAction(
      fetcher(new Promise(() => undefined)),
      () => ({ writePng }),
      vi.fn(),
    );
    void action.run(item(), context, new AbortController().signal);
    expect(writePng).toHaveBeenCalledOnce();
  });

  it("fails without downloading when the clipboard is unsupported", async () => {
    const f = fetcher(Promise.resolve(PNG_BYTES));
    const action = new CopyImageToClipboardAction(f, () => undefined, vi.fn());
    await expect(action.run(item(), context, new AbortController().signal)).rejects.toThrow(
      ClipboardUnsupportedError,
    );
    expect(f.fetchOriginal).not.toHaveBeenCalled();
  });

  it("reports the download failure rather than the clipboard's error", async () => {
    const downloadError = new Error("download failed");
    const clipboard: ImageClipboard = {
      writePng: async (png) => {
        try {
          await png;
        } catch {
          throw new Error("clipboard write failed");
        }
      },
    };
    const action = new CopyImageToClipboardAction(fetcher(Promise.reject(downloadError)), () => clipboard, vi.fn());
    await expect(action.run(item(), context, new AbortController().signal)).rejects.toBe(downloadError);
  });

  it("reports the clipboard's error when the image itself was fine", async () => {
    const writeError = new Error("NotAllowedError");
    const clipboard: ImageClipboard = { writePng: async () => Promise.reject(writeError) };
    const action = new CopyImageToClipboardAction(fetcher(Promise.resolve(PNG_BYTES)), () => clipboard, vi.fn());
    await expect(action.run(item(), context, new AbortController().signal)).rejects.toBe(writeError);
  });
});
