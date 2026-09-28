import type { ContextItem, ContextSource, DailyContext } from "../domain";

interface PendingCall {
  readonly context: DailyContext;
  readonly signal: AbortSignal;
  resolve(items: ContextItem[]): void;
  reject(err: unknown): void;
}

/** A source whose getItems() calls stay pending until the test settles them. */
export class DeferredSource implements ContextSource {
  readonly calls: PendingCall[] = [];
  available = true;

  constructor(readonly id: string, readonly name = id) {}

  isAvailable(): boolean {
    return this.available;
  }

  getItems(context: DailyContext, signal: AbortSignal): Promise<ContextItem[]> {
    return new Promise((resolve, reject) => {
      this.calls.push({ context, signal, resolve, reject });
    });
  }
}

export function item(sourceId: string, id: string, type: ContextItem["type"] = "note"): ContextItem {
  return { id, sourceId, type, title: id, payload: undefined };
}

export async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
