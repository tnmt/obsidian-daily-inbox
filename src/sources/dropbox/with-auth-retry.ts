import type { DropboxAuthClient } from "./auth";
import { DropboxApiError } from "./http";

// The single place a 401 gets one refresh-and-retry. Call sites should wrap
// the smallest unit of work that actually needs the token (not, e.g., an
// entire multi-request pagination loop) so a 401 partway through doesn't
// force redoing already-completed requests.
export async function withAuthRetry<T>(
  auth: DropboxAuthClient,
  signal: AbortSignal,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const token = await auth.getAccessToken(signal);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof DropboxApiError && err.status === 401) {
      const refreshed = await auth.refreshAfterUnauthorized(signal);
      return await fn(refreshed);
    }
    throw err;
  }
}
