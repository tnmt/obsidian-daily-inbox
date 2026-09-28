import type { ContextItem, ContextSource, DailyContext } from "./domain";

export type SourceResult =
  | { readonly kind: "unavailable" }
  | { readonly kind: "items"; readonly items: ContextItem[] }
  | { readonly kind: "error"; readonly error: unknown };

export class DailyContextService {
  constructor(readonly sources: readonly ContextSource[]) {}

  /**
   * Queries every source in parallel and reports each source's result as soon
   * as it settles. Results that settle after `signal` is aborted are dropped,
   * so cancellation needs no knowledge of source-specific error types.
   */
  async query(
    context: DailyContext,
    signal: AbortSignal,
    onResult: (source: ContextSource, result: SourceResult) => void,
  ): Promise<void> {
    await Promise.all(
      this.sources.map((source) =>
        querySource(source, context, signal, (result) => {
          if (!signal.aborted) onResult(source, result);
        }),
      ),
    );
  }
}

// Stays synchronous up to the first await so an unavailable source is
// reported before the caller paints its loading state.
async function querySource(
  source: ContextSource,
  context: DailyContext,
  signal: AbortSignal,
  report: (result: SourceResult) => void,
): Promise<void> {
  let pending: Promise<ContextItem[]>;
  try {
    if (!source.isAvailable()) {
      report({ kind: "unavailable" });
      return;
    }
    pending = source.getItems(context, signal);
  } catch (error) {
    report({ kind: "error", error });
    return;
  }
  let result: SourceResult;
  try {
    result = { kind: "items", items: await pending };
  } catch (error) {
    result = { kind: "error", error };
  }
  report(result);
}
