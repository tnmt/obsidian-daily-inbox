import type { ContextItem } from "../domain";
import type { OriginalImageFetcher } from "./copy-image-to-clipboard";

// Holds only the most recent original so that copying from the preview reuses
// the bytes the preview just downloaded, without keeping a library of
// full-size photos in memory.
export class SingleOriginalImageCache implements OriginalImageFetcher {
  private entry?: { readonly itemId: string; readonly signal: AbortSignal; readonly bytes: Promise<ArrayBuffer> };

  constructor(private readonly inner: OriginalImageFetcher) {}

  canFetch(item: ContextItem): boolean {
    return this.inner.canFetch(item);
  }

  // A cached download keeps the signal of the caller that started it; a later
  // caller's signal does not cancel it. An entry whose signal was aborted is
  // treated as absent even before its rejection settles.
  fetchOriginal(item: ContextItem, signal: AbortSignal): Promise<ArrayBuffer> {
    const cached = this.entry;
    if (cached && cached.itemId === item.id && !cached.signal.aborted) return cached.bytes;
    const bytes = this.inner.fetchOriginal(item, signal);
    const entry = { itemId: item.id, signal, bytes };
    this.entry = entry;
    bytes.catch(() => {
      if (this.entry === entry) this.entry = undefined;
    });
    return bytes;
  }
}
