import { describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import type { DailyContext } from "../../domain";
import { OnThisDaySource } from "./on-this-day-source";
import type { NoteHandle, VaultAccess } from "./vault-access";

function fakeVault(notes: Record<string, string>): VaultAccess {
  return {
    listDailyNoteFileNames: () => Object.keys(notes).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)),
    resolveDatedNote: (fileName) => (notes[fileName] !== undefined ? { path: `journal/${fileName}` } : undefined),
    readNote: async (note: NoteHandle) => notes[note.path.split("/").pop() as string],
  };
}

const config = {
  id: "on-this-day",
  name: "On this day",
  getExcerptHeading: () => "## 📝 Journal",
};

describe("OnThisDaySource", () => {
  it("returns past-year notes newest first, then future-year notes nearest first, with matching group labels", async () => {
    const source = new OnThisDaySource(
      config,
      fakeVault({
        "2021-09-28.md": "## 📝 Journal\nBefore.",
        "2023-09-28.md": "## 📝 Journal\nOne after.",
        "2026-09-28.md": "## 📝 Journal\nToday.",
        // Not the same MM-DD, must be filtered out.
        "2024-10-01.md": "## 📝 Journal\nOther date.",
      }),
    );
    const context: DailyContext = { date: localDate("2022-09-28") };
    const items = await source.getItems(context, new AbortController().signal);
    expect(items.map((i) => [i.title, i.groupLabel, i.subtitle])).toEqual([
      ["2021-09-28", "1 year ago", "Before."],
      ["2023-09-28", "1 year later", "One after."],
      ["2026-09-28", "4 years later", "Today."],
    ]);
  });

  it("excludes the context date's own year", async () => {
    const source = new OnThisDaySource(
      config,
      fakeVault({
        "2026-09-28.md": "## 📝 Journal\nToday.",
        "2025-09-28.md": "## 📝 Journal\nLast year.",
      }),
    );
    const context: DailyContext = { date: localDate("2026-09-28") };
    const items = await source.getItems(context, new AbortController().signal);
    expect(items.map((i) => i.title)).toEqual(["2025-09-28"]);
  });

  it("returns nothing when no other-year note exists for this MM-DD", async () => {
    const source = new OnThisDaySource(config, fakeVault({}));
    const context: DailyContext = { date: localDate("2026-09-27") };
    expect(await source.getItems(context, new AbortController().signal)).toEqual([]);
  });

  it("is always available", () => {
    expect(new OnThisDaySource(config, fakeVault({})).isAvailable()).toBe(true);
  });

  it("rejects once the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = new OnThisDaySource(config, fakeVault({ "2025-09-27.md": "text" }));
    const context: DailyContext = { date: localDate("2026-09-27") };
    await expect(source.getItems(context, controller.signal)).rejects.toThrow();
  });
});
