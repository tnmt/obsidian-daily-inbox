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

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new CancelledError());
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
