import { createCodeChallenge, createCodeVerifier } from "./pkce";
import type { HttpRequester } from "./http";
import { DropboxSourceError } from "./errors";
import { CancelledError, throwIfAborted } from "./cancel";

const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

// Refresh proactively once the access token is this close to expiring,
// instead of waiting for a 401 (docs/dropbox-oauth-design.md #4).
const REFRESH_MARGIN_MS = 5 * 60_000;

export interface DropboxTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAtMs: number;
}

export interface DropboxAuthPersistence {
  load(): DropboxTokens | undefined;
  save(tokens: DropboxTokens | undefined): Promise<void>;
}

interface TokenResponseBody {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

interface TokenErrorBody {
  error: string;
  error_description?: string;
}

export class DropboxTokenError extends Error {
  constructor(
    public readonly error: string,
    public readonly errorDescription: string | undefined,
    public readonly status: number,
  ) {
    super(errorDescription ?? error);
    this.name = "DropboxTokenError";
  }

  get isInvalidGrant(): boolean {
    return this.error === "invalid_grant";
  }
}

async function callTokenEndpoint(
  http: HttpRequester,
  params: URLSearchParams,
): Promise<TokenResponseBody> {
  const response = await http({
    url: TOKEN_URL,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: params.toString(),
    throw: false,
  });
  if (response.status >= 400) {
    const body = response.json as TokenErrorBody | undefined;
    throw new DropboxTokenError(
      body?.error ?? "unknown_error",
      body?.error_description,
      response.status,
    );
  }
  return response.json as TokenResponseBody;
}

function toTokens(body: TokenResponseBody, previousRefreshToken?: string): DropboxTokens {
  // A refresh grant response omits refresh_token; the existing one keeps working.
  const refreshToken = body.refresh_token ?? previousRefreshToken;
  if (!refreshToken) {
    throw new Error("Dropbox token response did not include a refresh_token.");
  }
  return {
    accessToken: body.access_token,
    refreshToken,
    expiresAtMs: Date.now() + body.expires_in * 1000,
  };
}

// The slice of DropboxAuthManager that DropboxSource depends on, so tests
// can supply a plain mock instead of a full manager.
export interface DropboxAuthClient {
  isConnected(): boolean;
  getAccessToken(signal: AbortSignal): Promise<string>;
  refreshAfterUnauthorized(signal: AbortSignal): Promise<string>;
}

export class DropboxAuthManager implements DropboxAuthClient {
  private tokens: DropboxTokens | undefined;
  private pendingCodeVerifier: string | undefined;
  private refreshInFlight: Promise<DropboxTokens> | undefined;
  // Bumped by disconnect()/cancelAuthorization() so an in-flight
  // completeAuthorization()/doRefresh() that resolves afterward can tell its
  // result is stale and must not resurrect or clobber the current state.
  private generation = 0;

  constructor(
    private readonly http: HttpRequester,
    private readonly getClientId: () => string,
    private readonly persistence: DropboxAuthPersistence,
  ) {
    this.tokens = persistence.load();
  }

  isConnected(): boolean {
    return this.tokens !== undefined;
  }

  hasPendingAuthorization(): boolean {
    return this.pendingCodeVerifier !== undefined;
  }

  /** Starts an authorization attempt and returns the URL the user should open. */
  async beginAuthorization(): Promise<string> {
    const verifier = createCodeVerifier();
    this.pendingCodeVerifier = verifier;
    this.generation++;
    const challenge = await createCodeChallenge(verifier);
    const params = new URLSearchParams({
      client_id: this.getClientId(),
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      token_access_type: "offline",
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Discards an in-progress authorization attempt without completing it. */
  cancelAuthorization(): void {
    this.pendingCodeVerifier = undefined;
    this.generation++;
  }

  /** Exchanges the code the user pasted back for tokens. */
  async completeAuthorization(code: string): Promise<void> {
    const verifier = this.pendingCodeVerifier;
    if (!verifier) {
      throw new DropboxSourceError(
        "auth-required",
        "No Dropbox authorization attempt is in progress.",
      );
    }
    const generation = this.generation;
    try {
      const body = await callTokenEndpoint(
        this.http,
        new URLSearchParams({
          code: code.trim(),
          grant_type: "authorization_code",
          client_id: this.getClientId(),
          code_verifier: verifier,
        }),
      );
      // A cancel or disconnect that happened while this request was in
      // flight already put the manager in the state it wants; don't
      // resurrect a connection on top of it.
      if (generation !== this.generation) return;
      this.tokens = toTokens(body);
      await this.persistence.save(this.tokens);
    } catch (err) {
      throw new DropboxSourceError(
        "auth-required",
        "Dropbox rejected the authorization code.",
        err,
      );
    } finally {
      this.pendingCodeVerifier = undefined;
    }
  }

  async disconnect(): Promise<void> {
    this.generation++;
    this.tokens = undefined;
    this.pendingCodeVerifier = undefined;
    await this.persistence.save(undefined);
  }

  /**
   * Returns a usable access token, refreshing first if it's near expiry. If
   * that proactive refresh fails transiently (network/429/5xx) but the
   * current token hasn't actually expired yet, the old token is used rather
   * than failing the whole call outright.
   */
  async getAccessToken(signal: AbortSignal): Promise<string> {
    if (!this.tokens) {
      throw new DropboxSourceError("auth-required", "Dropbox is not connected.");
    }
    if (this.tokens.expiresAtMs - Date.now() < REFRESH_MARGIN_MS) {
      try {
        await this.refresh(signal);
      } catch (err) {
        const stillValid = this.tokens !== undefined && this.tokens.expiresAtMs > Date.now();
        if (!stillValid || !(err instanceof DropboxSourceError) || err.kind !== "transient") {
          throw err;
        }
      }
    }
    return this.requireTokens().accessToken;
  }

  /** Forces a refresh after the caller sees a 401 despite a fresh-looking token. */
  async refreshAfterUnauthorized(signal: AbortSignal): Promise<string> {
    await this.refresh(signal);
    return this.requireTokens().accessToken;
  }

  private requireTokens(): DropboxTokens {
    if (!this.tokens) {
      throw new DropboxSourceError("auth-required", "Dropbox re-authentication is required.");
    }
    return this.tokens;
  }

  private refresh(signal: AbortSignal): Promise<DropboxTokens> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefresh(signal).finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private async doRefresh(signal: AbortSignal): Promise<DropboxTokens> {
    const current = this.requireTokens();
    const generation = this.generation;
    throwIfAborted(signal);
    try {
      const body = await callTokenEndpoint(
        this.http,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: this.getClientId(),
        }),
      );
      // The account was disconnected (or reconnected) while this refresh was
      // in flight; its result no longer applies to the current connection.
      if (generation !== this.generation) throw new CancelledError();
      this.tokens = toTokens(body, current.refreshToken);
      await this.persistence.save(this.tokens);
      return this.tokens;
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      if (err instanceof DropboxTokenError && err.isInvalidGrant) {
        this.tokens = undefined;
        await this.persistence.save(undefined);
        throw new DropboxSourceError(
          "auth-required",
          "Dropbox re-authentication is required.",
          err,
        );
      }
      // Network errors / 429 / 5xx: keep the stored tokens and let the
      // caller retry later rather than forcing the user to re-authenticate.
      throw new DropboxSourceError(
        "transient",
        "Could not refresh the Dropbox access token.",
        err,
      );
    }
  }
}
