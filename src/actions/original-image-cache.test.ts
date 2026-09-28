import { describe, expect, it, vi } from "vitest";
import type { ContextItem } from "../domain";
import type { OriginalImageFetcher } from "./copy-image-to-clipboard";
import { SingleOriginalImageCache } from "./original-image-cache";

function item(id: string): ContextItem {
  return { id, sourceId: "dropbox", type: "image", payload: {} };
}

function innerFetcher(impl: (item: ContextItem) => Promise<ArrayBuffer>) {
  const fetchOriginal = vi.fn((i: ContextItem, _signal: AbortSignal) => impl(i));
  const fetcher: OriginalImageFetcher = { canFetch: (i) => i.sourceId === "dropbox", fetchOriginal };
  return { fetcher, fetchOriginal };
}

describe("SingleOriginalImageCache", () => {
  it("downloads an item's original once across repeated fetches", async () => {
    const bytes = new ArrayBuffer(4);
    const { fetcher, fetchOriginal } = innerFetcher(async () => bytes);
    const cache = new SingleOriginalImageCache(fetcher);

    await expect(cache.fetchOriginal(item("a"), new AbortController().signal)).resolves.toBe(bytes);
    await expect(cache.fetchOriginal(item("a"), new AbortController().signal)).resolves.toBe(bytes);
    expect(fetchOriginal).toHaveBeenCalledTimes(1);
  });

  it("replaces the cached original when a different item is fetched", async () => {
    const { fetcher, fetchOriginal } = innerFetcher(async () => new ArrayBuffer(1));
    const cache = new SingleOriginalImageCache(fetcher);
    const signal = new AbortController().signal;

    await cache.fetchOriginal(item("a"), signal);
    await cache.fetchOriginal(item("b"), signal);
    await cache.fetchOriginal(item("a"), signal);
    expect(fetchOriginal.mock.calls.map(([i]) => i.id)).toEqual(["a", "b", "a"]);
  });

  it("does not cache a rejected download", async () => {
    const bytes = new ArrayBuffer(2);
    let calls = 0;
    const { fetcher, fetchOriginal } = innerFetcher(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      return bytes;
    });
    const cache = new SingleOriginalImageCache(fetcher);
    const signal = new AbortController().signal;

    await expect(cache.fetchOriginal(item("a"), signal)).rejects.toThrow("network");
    await expect(cache.fetchOriginal(item("a"), signal)).resolves.toBe(bytes);
    expect(fetchOriginal).toHaveBeenCalledTimes(2);
  });

  it("re-downloads when the cached download's signal was aborted before it settled", async () => {
    const { fetcher, fetchOriginal } = innerFetcher(() => new Promise<ArrayBuffer>(() => {}));
    const cache = new SingleOriginalImageCache(fetcher);
    const first = new AbortController();

    void cache.fetchOriginal(item("a"), first.signal);
    first.abort();
    void cache.fetchOriginal(item("a"), new AbortController().signal);
    expect(fetchOriginal).toHaveBeenCalledTimes(2);
  });
});
