import { describe, expect, it } from "vitest";
import { DailyInboxRefresher, partitionItems } from "./daily-inbox-refresh";
import type { SectionState, SourceSection } from "./daily-inbox-refresh";
import { localDate } from "./domain";
import type { ContextSource, DailyContext } from "./domain";
import { DeferredSource, flush, item } from "./test-support/fake-source";

const dayA: DailyContext = { date: localDate("2026-09-23") };
const dayB: DailyContext = { date: localDate("2026-09-24") };

function section(source: ContextSource): SourceSection {
  return {
    source,
    emptyMessage: `No ${source.id} items.`,
    describeUnavailable: () => `${source.id} is off.`,
    describeError: (err) => `${source.id} failed: ${(err as Error).message}`,
  };
}

function setup(sources: ContextSource[]) {
  const updates: Array<[string, SectionState]> = [];
  const latest = new Map<string, SectionState>();
  const refresher = new DailyInboxRefresher(sources.map(section), (s, state) => {
    updates.push([s.source.id, state]);
    latest.set(s.source.id, state);
  });
  return { refresher, updates, latest };
}

describe("DailyInboxRefresher", () => {
  it("renders each section independently of the others' failures", async () => {
    const ok = new DeferredSource("ok");
    const broken = new DeferredSource("broken");
    const off = new DeferredSource("off");
    off.available = false;
    const { refresher, updates, latest } = setup([ok, broken, off]);

    const done = refresher.refresh(dayA);
    expect(latest.get("ok")).toEqual({ kind: "loading" });
    expect(latest.get("broken")).toEqual({ kind: "loading" });
    expect(latest.get("off")).toEqual({ kind: "unavailable", message: "off is off." });

    broken.calls[0].reject(new Error("boom"));
    await flush();
    expect(latest.get("broken")).toEqual({ kind: "error", message: "broken failed: boom" });
    expect(latest.get("ok")).toEqual({ kind: "loading" });

    ok.calls[0].resolve([item("ok", "a")]);
    await done;
    expect(latest.get("ok")).toEqual({ kind: "items", items: [item("ok", "a")] });
    expect(updates.filter(([id]) => id === "ok").map(([, s]) => s.kind)).toEqual(["loading", "items"]);
  });

  it("cancels every source of the previous refresh and never reports its late results", async () => {
    const photos = new DeferredSource("photos");
    const notes = new DeferredSource("notes");
    const { refresher, updates, latest } = setup([photos, notes]);

    void refresher.refresh(dayA);
    const [photosA] = photos.calls;
    const [notesA] = notes.calls;
    const doneB = refresher.refresh(dayB);
    expect(photosA.signal.aborted).toBe(true);
    expect(notesA.signal.aborted).toBe(true);
    const [, photosB] = photos.calls;
    const [, notesB] = notes.calls;
    expect(photosB.context).toBe(dayB);

    const afterB = updates.length;
    photosA.resolve([item("photos", "from-a", "image")]);
    notesA.reject(new Error("late failure"));
    await flush();
    expect(updates.length).toBe(afterB);

    photosB.resolve([item("photos", "from-b", "image")]);
    notesB.resolve([]);
    await doneB;
    expect(latest.get("photos")).toEqual({ kind: "items", items: [item("photos", "from-b", "image")] });
    expect(latest.get("notes")).toEqual({ kind: "items", items: [] });
  });

  it("drops results that arrive after cancel()", async () => {
    const source = new DeferredSource("photos");
    const { refresher, updates } = setup([source]);

    const done = refresher.refresh(dayA);
    refresher.cancel();
    expect(source.calls[0].signal.aborted).toBe(true);
    source.calls[0].resolve([item("photos", "a")]);
    await done;

    expect(updates).toEqual([["photos", { kind: "loading" }]]);
  });
});

describe("partitionItems", () => {
  it("separates images from other item types, preserving order", () => {
    const items = [
      item("s", "1", "note"),
      item("s", "2", "image"),
      item("s", "3", "link"),
      item("s", "4", "image"),
      item("s", "5", "activity"),
    ];
    const { images, others } = partitionItems(items);
    expect(images.map((i) => i.id)).toEqual(["2", "4"]);
    expect(others.map((i) => i.id)).toEqual(["1", "3", "5"]);
  });
});
