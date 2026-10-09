import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import { CancelledError } from "../dropbox/cancel";
import { WithingsSourceError } from "./errors";

/** Registered as the redirect URI of the user's Withings application. */
export const CALLBACK_PORT = 8123;
export const CALLBACK_PATH = "/callback";

export function redirectUri(port: number = CALLBACK_PORT): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

export interface CallbackServerOptions {
  readonly port: number;
  /** Requests whose `state` differs are answered with 400 and otherwise ignored. */
  readonly state: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface CallbackHandle {
  readonly port: number;
  /** Settles once with the authorization code; the listener is closed by then. */
  readonly code: Promise<string>;
}

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Daily Inbox</title><p>${message}</p>`;

/**
 * Listens on the loopback interface only for the one redirect of a pending
 * authorization, then closes. Resolves once the socket is bound so the caller
 * can open the authorization URL knowing the redirect will be received.
 */
export function startCallbackServer(options: CallbackServerOptions): Promise<CallbackHandle> {
  const { state, signal, timeoutMs } = options;
  return new Promise((resolveStarted, rejectStarted) => {
    if (signal.aborted) {
      rejectStarted(new CancelledError());
      return;
    }
    let settle!: (outcome: { code: string } | { error: Error }) => void;
    const code = new Promise<string>((resolve, reject) => {
      settle = (outcome) => ("code" in outcome ? resolve(outcome.code) : reject(outcome.error));
    });
    // A failure before anyone awaits `code` is reported through the start
    // promise instead; this only keeps it from surfacing as unhandled.
    code.catch(() => undefined);
    let done = false;
    let listening = false;
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE("Invalid state."));
        return;
      }
      const authCode = url.searchParams.get("code");
      if (!authCode) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE("Authorization was not granted."));
        finish({ error: new WithingsSourceError("auth-required", "Withings authorization was not granted.") }, res);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE("Connected. You can close this tab."));
      finish({ code: authCode }, res);
    });

    const timer = setTimeout(
      () => finish({ error: new WithingsSourceError("auth-required", "Timed out waiting for Withings authorization.") }),
      timeoutMs,
    );
    const onAbort = () => finish({ error: new CancelledError() });

    function finish(outcome: { code: string } | { error: Error }, res?: ServerResponse): void {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      // Ending before the socket is bound must also settle the start promise,
      // otherwise the caller waits on it forever.
      if (!listening && "error" in outcome) rejectStarted(outcome.error);
      server.close();
      // Destroying the socket right after res.end() can drop the page that is
      // still in the write buffer, so wait for it to be flushed.
      if (res && !res.writableFinished) res.once("finish", () => server.closeAllConnections());
      else server.closeAllConnections();
      settle(outcome);
    }

    server.once("error", (err: NodeJS.ErrnoException) => {
      const failure = new WithingsSourceError(
        "transient",
        err.code === "EADDRINUSE"
          ? `Port ${options.port} is in use, so the Withings redirect cannot be received.`
          : "Could not start the Withings redirect listener.",
        err,
      );
      finish({ error: failure });
    });
    signal.addEventListener("abort", onAbort, { once: true });
    server.listen(options.port, "127.0.0.1", () => {
      listening = true;
      if (done) {
        // Ended while the socket was still being bound.
        server.close();
        return;
      }
      const address = server.address();
      resolveStarted({ port: typeof address === "object" && address ? address.port : options.port, code });
    });
  });
}
