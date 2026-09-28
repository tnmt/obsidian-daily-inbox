// requestUrl (see http.ts) cannot be aborted at the network level, so
// cancellation here is cooperative: every async step checks the signal and
// throws CancelledError, which callers treat the same as an AbortError from
// a native fetch (silently drop the result rather than surfacing an error).
export class CancelledError extends Error {
  constructor() {
    super("Operation was cancelled.");
    this.name = "CancelledError";
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError();
}
