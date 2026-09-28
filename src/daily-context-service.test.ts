import { describe, expect, it, vi } from "vitest";
import { DailyContextService } from "./daily-context-service";
import type { SourceResult } from "./daily-context-service";
import { localDate } from "./domain";
import type { ContextSource, DailyContext } from "./domain";
import { DeferredSource, flush, item } from "./test-support/fake-source";

const context: DailyContext = { date: localDate("2026-09-23") };

function collect() {
  const results: Array<[string, SourceResult]> = [];
  const onResult = (source: ContextSource, result: SourceResult) => results.push([source.id, result]);
  return { results, onResult };
}

describe("DailyContextService", () => {
  it("queries every source in parallel with the shared signal and reports each as it settles", async () => {
    const fast = new DeferredSource("fast");
    const slow = new DeferredSource("slow");
    const service = new DailyContextService([slow, fast]);
    const controller = new AbortController();
    const { results, onResult } = collect();

    const done = service.query(context, controller.signal, onResult);
    expect(slow.calls).toHaveLength(1);
    expect(fast.calls).toHaveLength(1);
    expect(slow.calls[0].signal).toBe(controller.signal);
    expect(fast.calls[0].signal).toBe(controller.signal);

    fast.calls[0].resolve([item("fast", "a")]);
    await flush();
    expect(results).toEqual([["fast", { kind: "items", items: [item("fast", "a")] }]]);

    slow.calls[0].resolve([]);
    await done;
    expect(results.map(([id]) => id)).toEqual(["fast", "slow"]);
  });

  it("isolates a failing source to its own error result", async () => {
    const ok = new DeferredSource("ok");
    const rejects = new DeferredSource("rejects");
    const syncThrow: ContextSource = {
      id: "sync-throw",
      name: "Sync throw",
      isAvailable: () => true,
      getItems: () => {
        throw new Error("boom");
      },
    };
    const availabilityThrow: ContextSource = {
      id: "availability-throw",
      name: "Availability throw",
      isAvailable: () => {
        throw new Error("boom");
      },
      getItems: async () => [],
    };
    const service = new DailyContextService([rejects, syncThrow, availabilityThrow, ok]);
    const { results, onResult } = collect();

    const done = service.query(context, new AbortController().signal, onResult);
    const failure = new Error("network");
    rejects.calls[0].reject(failure);
    ok.calls[0].resolve([item("ok", "a")]);
    await done;

    expect(Object.fromEntries(results)).toEqual({
      rejects: { kind: "error", error: failure },
      "sync-throw": { kind: "error", error: new Error("boom") },
      "availability-throw": { kind: "error", error: new Error("boom") },
      ok: { kind: "items", items: [item("ok", "a")] },
    });
  });

  it("reports an unavailable source synchronously without querying it", () => {
    const source = new DeferredSource("off");
    source.available = false;
    const getItems = vi.spyOn(source, "getItems");
    const service = new DailyContextService([source]);
    const { results, onResult } = collect();

    void service.query(context, new AbortController().signal, onResult);

    expect(results).toEqual([["off", { kind: "unavailable" }]]);
    expect(getItems).not.toHaveBeenCalled();
  });

  it("drops results that settle after the signal is aborted", async () => {
    const resolves = new DeferredSource("resolves");
    const rejects = new DeferredSource("rejects");
    const service = new DailyContextService([resolves, rejects]);
    const controller = new AbortController();
    const { results, onResult } = collect();

    const done = service.query(context, controller.signal, onResult);
    controller.abort();
    resolves.calls[0].resolve([item("resolves", "a")]);
    rejects.calls[0].reject(new Error("cancelled"));
    await done;

    expect(results).toEqual([]);
  });
});
