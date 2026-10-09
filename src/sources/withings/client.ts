import type { HttpRequester } from "../dropbox/http";
import { postWithings, RATE_LIMIT_STATUS, WithingsStatusError } from "./api";
import { WithingsSourceError } from "./errors";

const MEASURE_URL = "https://wbsapi.withings.net/measure";

/** Envelope statuses that mean the access token is no longer accepted. */
const INVALID_TOKEN_STATUSES = new Set([401, 293]);

export class AccessTokenRejectedError extends Error {
  constructor() {
    super("Withings rejected the access token.");
    this.name = "AccessTokenRejectedError";
  }
}

export interface Measure {
  readonly type: number;
  /** Already decoded as `value * 10^unit`. */
  readonly value: number;
}

export interface MeasureGroup {
  /** Unix seconds at which the measurement was taken. */
  readonly date: number;
  readonly measures: Measure[];
}

export interface MeasuresResponse {
  /** IANA zone of the account, which defines the calendar day of each group. */
  readonly timezone: string;
  readonly groups: MeasureGroup[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function fetchMeasures(
  http: HttpRequester,
  accessToken: string,
  startUnix: number,
  endUnix: number,
  signal: AbortSignal,
): Promise<MeasuresResponse> {
  let body;
  try {
    body = await postWithings(
      http,
      MEASURE_URL,
      { action: "getmeas", category: "1", startdate: String(startUnix), enddate: String(endUnix) },
      accessToken,
      signal,
    );
  } catch (err) {
    if (!(err instanceof WithingsStatusError)) throw err;
    if (INVALID_TOKEN_STATUSES.has(err.status)) throw new AccessTokenRejectedError();
    if (err.status === RATE_LIMIT_STATUS) {
      throw new WithingsSourceError("rate-limited", "Withings rate limit reached.", err);
    }
    throw new WithingsSourceError("transient", `Withings returned status ${err.status}.`, err);
  }
  return parseMeasuresResponse(body);
}

export function parseMeasuresResponse(body: Record<string, unknown>): MeasuresResponse {
  const { timezone, measuregrps } = body;
  if (typeof timezone !== "string" || !Array.isArray(measuregrps)) {
    throw new WithingsSourceError("malformed", "Unexpected Withings measure response shape.");
  }
  const groups = measuregrps.map((raw): MeasureGroup => {
    if (!isRecord(raw) || typeof raw.date !== "number" || !Array.isArray(raw.measures)) {
      throw new WithingsSourceError("malformed", "Unexpected measure group in Withings response.");
    }
    const measures = raw.measures.map((m): Measure => {
      if (!isRecord(m) || typeof m.type !== "number" || typeof m.value !== "number" || typeof m.unit !== "number") {
        throw new WithingsSourceError("malformed", "Unexpected measure in Withings response.");
      }
      return { type: m.type, value: m.value * Math.pow(10, m.unit) };
    });
    return { date: raw.date, measures };
  });
  return { timezone, groups };
}
