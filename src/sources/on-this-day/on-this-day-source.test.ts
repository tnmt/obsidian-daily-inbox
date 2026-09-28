import { describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import type { DailyContext } from "../../domain";
import { OnThisDaySource } from "./on-this-day-source";
import type { NoteHandle, VaultAccess } from "./vault-access";

function fakeVault(notes: Record<string, string>): VaultAccess {
  return {
    resolveDatedNote: (fileName) => (notes[fileName] !== undefined ? { path: `journal/${fileName}` } : undefined),
    readNote: async (note: NoteHandle) => notes[note.path.split("/").pop() as string],
  };
}

const config = {
  id: "on-this-day",
  name: "On this day",
  getYearsBack: () => 3,
  getExcerptHeading: () => "## 📝 Journal",
};

describe("OnThisDaySource", () => {
  it("returns one item per resolvable past year, newest first, with year-ago group labels", async () => {
    const source = new OnThisDaySource(
      config,
      fakeVault({
        "2025-09-27.md": "## 📝 Journal\nWent hiking.",
        "2023-09-27.md": "## 📝 Journal\nStayed home.",
      }),
    );
    const context: DailyContext = { date: localDate("2026-09-27") };
    const items = await source.getItems(context, new AbortController().signal);
    expect(items.map((i) => [i.title, i.groupLabel, i.subtitle])).toEqual([
      ["2025-09-27", "1 year ago", "Went hiking."],
      ["2023-09-27", "3 years ago", "Stayed home."],
    ]);
  });

  it("skips years with no matching note", async () => {
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
