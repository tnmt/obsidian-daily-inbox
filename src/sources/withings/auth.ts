import { CancelledError, throwIfAborted } from "../dropbox/cancel";
import type { HttpRequester } from "../dropbox/http";
import { postWithings, RATE_LIMIT_STATUS, WithingsStatusError } from "./api";
import { CALLBACK_PORT, redirectUri, startCallbackServer } from "./callback-server";
import type { CallbackHandle, CallbackServerOptions } from "./callback-server";
import { WithingsSourceError } from "./errors";

const AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2";
const TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
const SCOPE = "user.metrics";
const INVALID_PARAMS_STATUS = 503;

// The access token lasts 3 hours; refresh a little early rather than on a 401.
const REFRESH_MARGIN_MS = 5 * 60_000;
// The authorization code itself expires 30 seconds after the redirect, but the
// user may spend a while on the Withings login and consent pages first.
const AUTHORIZATION_TIMEOUT_MS = 5 * 60_000;

export interface WithingsTokens {
  readonly userId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAtMs: number;
}

export interface WithingsAuthPersistence {
  load(): WithingsTokens | undefined;
  save(tokens: WithingsTokens | undefined): Promise<void>;
}

export interface WithingsCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

// The slice of WithingsAuthManager that WithingsSource depends on, so tests
// can supply a plain mock instead of a full manager.
export interface WithingsAuthClient {
  isConnected(): boolean;
  /** Identifies the connected account, so cached data is never shown for another one. */
  userId(): string | undefined;
  getAccessToken(signal: AbortSignal): Promise<string>;
  refreshAfterUnauthorized(signal: AbortSignal): Promise<string>;
}

function toTokens(body: Record<string, unknown>): WithingsTokens {
  const { userid, access_token, refresh_token, expires_in } = body;
  if (
    (typeof userid !== "string" && typeof userid !== "number") ||
    typeof access_token !== "string" ||
    typeof refresh_token !== "string" ||
    typeof expires_in !== "number"
  ) {
    throw new WithingsSourceError("malformed", "Unexpected Withings token response.");
  }
  return {
    userId: String(userid),
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAtMs: Date.now() + expires_in * 1000,
  };
}

export class WithingsAuthManager implements WithingsAuthClient {
  private tokens: WithingsTokens | undefined;
  private pendingAuthorization: AbortController | undefined;
  private refreshInFlight: Promise<WithingsTokens> | undefined;
  // Rotated tokens whose write to storage failed. They are kept so the
  // rotation is not lost, but no access token is handed out until a retry of
  // the write succeeds.
  private unsaved: WithingsTokens | undefined;
  // Bumped by disconnect() so an in-flight authorization or refresh that
  // resolves afterward knows its result is stale and must not resurrect or
  // clobber the current state.
  private generation = 0;

  constructor(
    private readonly http: HttpRequester,
    private readonly getCredentials: () => WithingsCredentials,
    private readonly persistence: WithingsAuthPersistence,
    private readonly listen: (options: CallbackServerOptions) => Promise<CallbackHandle> = startCallbackServer,
    private readonly port: number = CALLBACK_PORT,
  ) {
    this.tokens = persistence.load();
  }

  isConnected(): boolean {
    return this.tokens !== undefined;
  }

  userId(): string | undefined {
    return this.tokens?.userId;
  }

  hasPendingAuthorization(): boolean {
    return this.pendingAuthorization !== undefined;
  }

  /**
   * Runs the authorization-code flow: listens for the redirect, hands the
   * authorization URL to `openUrl`, and exchanges the returned code before
   * the listener is torn down. Resolves once the tokens are persisted.
   */
  async connect(openUrl: (url: string) => void): Promise<void> {
    if (this.pendingAuthorization) {
      throw new WithingsSourceError("auth-required", "A Withings authorization is already in progress.");
    }
    const { clientId } = this.getCredentials();
    const abort = new AbortController();
    this.pendingAuthorization = abort;
    const generation = ++this.generation;
    try {
      const state = randomState();
      const handle = await this.listen({ port: this.port, state, signal: abort.signal, timeoutMs: AUTHORIZATION_TIMEOUT_MS });
      const redirect = redirectUri(handle.port);
      openUrl(
        `${AUTHORIZE_URL}?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          scope: SCOPE,
          redirect_uri: redirect,
          state,
        }).toString()}`,
      );
      const code = await handle.code;
      const body = await this.requestToken(
        { action: "requesttoken", grant_type: "authorization_code", code, redirect_uri: redirect },
        abort.signal,
      );
      if (generation !== this.generation || abort.signal.aborted) throw new CancelledError();
      const next = toTokens(body);
      // Memory is updated only once storage has the tokens, so a failed write
      // cannot leave a session that looks connected but is gone after restart.
      await this.persistence.save(next);
      if (generation !== this.generation || abort.signal.aborted) {
        // Cancelled or disconnected during the write; put storage back to the
        // state memory holds.
        await this.persistence.save(this.tokens);
        throw new CancelledError();
      }
      // Anything an earlier failed write left behind belongs to the old connection.
      this.unsaved = undefined;
      this.tokens = next;
    } finally {
      if (this.pendingAuthorization === abort) this.pendingAuthorization = undefined;
    }
  }

  /** Aborts an in-progress authorization, closing its listener. */
  cancelAuthorization(): void {
    this.pendingAuthorization?.abort();
  }

  async disconnect(): Promise<void> {
    this.generation++;
    this.cancelAuthorization();
    this.tokens = undefined;
    this.unsaved = undefined;
    await this.persistence.save(undefined);
  }

  async getAccessToken(signal: AbortSignal): Promise<string> {
    if (!this.tokens) {
      throw new WithingsSourceError("auth-required", "Withings is not connected.");
    }
    await this.persistUnsaved();
    if (this.tokens.expiresAtMs - Date.now() < REFRESH_MARGIN_MS) {
      try {
        await this.refresh(signal);
      } catch (err) {
        // A transient failure of the proactive refresh is survivable while the
        // current token is still valid.
        const stillValid = this.tokens !== undefined && this.tokens.expiresAtMs > Date.now();
        const survivable = err instanceof WithingsSourceError && (err.kind === "transient" || err.kind === "rate-limited");
        if (!stillValid || !survivable || this.unsaved) throw err;
      }
    }
    return this.requireTokens().accessToken;
  }

  /** Forces a refresh after the caller sees a 401 despite a fresh-looking token. */
  async refreshAfterUnauthorized(signal: AbortSignal): Promise<string> {
    await this.refresh(signal);
    return this.requireTokens().accessToken;
  }

  private async persistUnsaved(): Promise<void> {
    const pending = this.unsaved;
    if (!pending) return;
    try {
      await this.persistence.save(pending);
    } catch (err) {
      throw new WithingsSourceError("transient", "Could not store the refreshed Withings tokens.", err);
    }
    if (this.unsaved === pending) {
      this.unsaved = undefined;
    } else {
      // A newer refresh replaced it while this write was in flight, so storage
      // now holds the older tokens; write the current ones back.
      await this.persistence.save(this.tokens);
    }
  }

  private requireTokens(): WithingsTokens {
    if (!this.tokens) {
      throw new WithingsSourceError("auth-required", "Withings re-authentication is required.");
    }
    return this.tokens;
  }

  // Serialized: the refresh token rotates on every use, so two concurrent
  // refreshes would invalidate each other.
  private refresh(signal: AbortSignal): Promise<WithingsTokens> {
    throwIfAborted(signal);
    if (!this.refreshInFlight) {
      // Deliberately not tied to the caller's signal: once the request is sent
      // Withings has rotated the refresh token, so the response must reach
      // storage even if the view that triggered the refresh has moved on, and
      // the result is shared with callers whose signals are still live.
      this.refreshInFlight = this.doRefresh(new AbortController().signal).finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private async doRefresh(signal: AbortSignal): Promise<WithingsTokens> {
    const current = this.requireTokens();
    const generation = this.generation;
    try {
      const body = await this.requestToken(
        { action: "requesttoken", grant_type: "refresh_token", refresh_token: current.refreshToken },
        signal,
      );
      if (generation !== this.generation) throw new CancelledError();
      const next = toTokens(body);
      // The old refresh token is replaced by the new one on Withings' side, so
      // it must reach storage before the new access token is used anywhere.
      // Callers arriving meanwhile wait on refreshInFlight, which spans the write.
      try {
        await this.persistence.save(next);
      } catch (saveErr) {
        if (generation === this.generation) {
          this.tokens = next;
          this.unsaved = next;
        }
        throw new WithingsSourceError("transient", "Could not store the refreshed Withings tokens.", saveErr);
      }
      if (generation !== this.generation) {
        // disconnect() ran during the write; put storage back to its state.
        await this.persistence.save(this.tokens);
        throw new CancelledError();
      }
      // Whatever an earlier failed write left behind is older than `next`.
      this.unsaved = undefined;
      this.tokens = next;
      return next;
    } catch (err) {
      if (generation !== this.generation && !(err instanceof CancelledError)) throw new CancelledError();
      if (err instanceof WithingsSourceError && err.kind === "auth-required") {
        this.tokens = undefined;
        this.unsaved = undefined;
        await this.persistence.save(undefined);
      }
      throw err;
    }
  }

  private async requestToken(
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const { clientId, clientSecret } = this.getCredentials();
    throwIfAborted(signal);
    try {
      return await postWithings(
        this.http,
        TOKEN_URL,
        { ...params, client_id: clientId.trim(), client_secret: clientSecret.trim() },
        undefined,
        signal,
      );
    } catch (err) {
      if (!(err instanceof WithingsStatusError)) throw err;
      if (err.status === RATE_LIMIT_STATUS) {
        throw new WithingsSourceError("rate-limited", "Withings rate limit reached.", err);
      }
      // Withings answers an invalid or expired code and an invalid refresh
      // token with 503 ("Invalid Params"), so that one is a rejection. Other
      // 5xx-range statuses are treated as Withings-side faults and leave the
      // stored tokens alone.
      if (err.status >= 500 && err.status < 600 && err.status !== INVALID_PARAMS_STATUS) {
        throw new WithingsSourceError("transient", "Withings is temporarily unavailable.", err);
      }
      throw new WithingsSourceError("auth-required", "Withings rejected the credentials or token.", err);
    }
  }
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
