import { describe, expect, it, vi } from "vitest";
import { localDate } from "../domain";
import type { ContextItem, DailyContext } from "../domain";
import { OpenNoteAction } from "./open-note";

const context: DailyContext = { date: localDate("2026-09-27") };

function noteItem(path: string): ContextItem {
  return { id: "x", sourceId: "on-this-day", type: "note", payload: { path } };
}

describe("OpenNoteAction", () => {
  it("only handles note items", () => {
    const action = new OpenNoteAction({ open: vi.fn() });
    expect(action.canHandle(noteItem("a.md"))).toBe(true);
    expect(action.canHandle({ id: "x", sourceId: "s", type: "link", payload: {} })).toBe(false);
  });

  it("opens the note at the item's path", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const action = new OpenNoteAction({ open });
    await action.run(noteItem("journal/2025-09-27.md"), context, new AbortController().signal);
    expect(open).toHaveBeenCalledWith("journal/2025-09-27.md");
  });
});
