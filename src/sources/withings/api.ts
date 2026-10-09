import { throwIfAborted } from "../dropbox/cancel";
import type { HttpRequester } from "../dropbox/http";
import { WithingsSourceError } from "./errors";

export const RATE_LIMIT_STATUS = 601;

/** A non-zero `status` in a Withings response envelope; the HTTP status is 200 for these. */
export class WithingsStatusError extends Error {
  constructor(public readonly status: number) {
    super(`Withings returned status ${status}.`);
    this.name = "WithingsStatusError";
  }
}

/**
 * POSTs a form to a Withings endpoint and returns the envelope's `body`.
 * Network failures and HTTP 5xx become "transient", an unparsable response
 * "malformed", and a non-zero envelope status a WithingsStatusError for the
 * caller to classify, because the same status means different things for the
 * token endpoint and the data endpoints.
 */
export async function postWithings(
  http: HttpRequester,
  url: string,
  params: Record<string, string>,
  accessToken: string | undefined,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  throwIfAborted(signal);
  let response;
  try {
    response = await http({
      url,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      body: new URLSearchParams(params).toString(),
      throw: false,
    });
  } catch (err) {
    throwIfAborted(signal);
    throw new WithingsSourceError("transient", "Could not reach Withings.", err);
  }
  throwIfAborted(signal);

  if (response.status >= 400) {
    throw new WithingsSourceError("transient", `Withings error (${response.status}).`);
  }
  let envelope: unknown;
  try {
    envelope = response.json;
  } catch (err) {
    throw new WithingsSourceError("malformed", "Withings returned invalid JSON.", err);
  }
  if (typeof envelope !== "object" || envelope === null || typeof (envelope as { status?: unknown }).status !== "number") {
    throw new WithingsSourceError("malformed", "Unexpected Withings response shape.");
  }
  const { status, body } = envelope as { status: number; body?: unknown };
  if (status !== 0) throw new WithingsStatusError(status);
  if (typeof body !== "object" || body === null) {
    throw new WithingsSourceError("malformed", "Withings response has no body.");
  }
  return body as Record<string, unknown>;
}
