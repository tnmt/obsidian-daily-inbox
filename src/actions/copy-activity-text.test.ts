import { describe, expect, it } from "vitest";
import type { ContextItem, DailyContext } from "../domain";
import { localDate } from "../domain";
import { CopyActivityTextAction } from "./copy-activity-text";
import type { TextClipboard } from "./copy-markdown-link";
import { ClipboardUnsupportedError } from "./errors";

const context: DailyContext = { date: localDate("2026-09-30") };

function item(overrides: Partial<ContextItem> = {}): ContextItem {
  return { id: "location:stay:1", sourceId: "location", type: "activity", payload: { text: "09:39–11:15 Office" }, ...overrides };
}

describe("CopyActivityTextAction", () => {
  it("handles activity items that carry text", () => {
    const action = new CopyActivityTextAction(() => undefined);
    expect(action.canHandle(item())).toBe(true);
    expect(action.canHandle(item({ type: "link" }))).toBe(false);
    expect(action.canHandle(item({ payload: { url: "x" } }))).toBe(false);
    expect(action.canHandle(item({ payload: undefined }))).toBe(false);
  });

  it("writes the prepared text", async () => {
    const written: string[] = [];
    const clipboard: TextClipboard = { writeText: async (text) => void written.push(text) };
    await new CopyActivityTextAction(() => clipboard).run(item(), context, new AbortController().signal);
    expect(written).toEqual(["09:39–11:15 Office"]);
  });

  it("reports a missing clipboard", async () => {
    await expect(
      new CopyActivityTextAction(() => undefined).run(item(), context, new AbortController().signal),
    ).rejects.toThrow(ClipboardUnsupportedError);
  });
});
