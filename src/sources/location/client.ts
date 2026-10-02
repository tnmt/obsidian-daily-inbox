import type { LocalDate } from "../../domain";
import { throwIfAborted } from "../dropbox/cancel";
import type { HttpRequester } from "../dropbox/http";
import { LocationSourceError } from "./errors";

/** One stay as returned by overland-server's `GET /api/days/{date}`. */
export interface DayStay {
  /** RFC 3339 timestamp in the server's configured time zone. */
  readonly start: string;
  readonly end: string;
  readonly placeName?: string;
  readonly source: string;
}

export interface DayMove {
  readonly start: string;
  readonly end: string;
  readonly mode: string;
  readonly distanceMeters: number;
}

export interface DayResponse {
  readonly stays: DayStay[];
  readonly moves: DayMove[];
}

export async function fetchDay(
  http: HttpRequester,
  baseUrl: string,
  token: string,
  date: LocalDate,
  signal: AbortSignal,
): Promise<DayResponse> {
  throwIfAborted(signal);
  let response;
  try {
    response = await http({
      url: `${baseUrl.trim().replace(/\/+$/, "")}/api/days/${date}`,
      method: "GET",
      headers: { Authorization: `Bearer ${token.trim()}` },
      throw: false,
    });
  } catch (err) {
    throwIfAborted(signal);
    throw new LocationSourceError("transient", "Could not reach the location server.", err);
  }
  throwIfAborted(signal);

  if (response.status === 401 || response.status === 403) {
    throw new LocationSourceError("auth-required", `Location server rejected the token (${response.status}).`);
  }
  if (response.status === 404) {
    throw new LocationSourceError("not-found", "No location API at the configured URL.");
  }
  if (response.status >= 400) {
    throw new LocationSourceError("transient", `Location server error (${response.status}).`);
  }

  let body: unknown;
  try {
    body = response.json;
  } catch (err) {
    throw new LocationSourceError("malformed", "Location server returned invalid JSON.", err);
  }
  return parseDayResponse(body);
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    throw new LocationSourceError("malformed", `Unexpected timestamp in location response: ${String(value)}`);
  }
  return value;
}

export function parseDayResponse(body: unknown): DayResponse {
  if (!isRecord(body) || !Array.isArray(body.stays) || !Array.isArray(body.moves)) {
    throw new LocationSourceError("malformed", "Unexpected location response shape.");
  }
  const stays = body.stays.map((raw): DayStay => {
    if (!isRecord(raw)) throw new LocationSourceError("malformed", "Unexpected stay in location response.");
    const place = isRecord(raw.place) && typeof raw.place.name === "string" ? raw.place.name : undefined;
    return {
      start: timestamp(raw.start),
      end: timestamp(raw.end),
      placeName: place,
      source: typeof raw.source === "string" ? raw.source : "",
    };
  });
  const moves = body.moves.map((raw): DayMove => {
    if (!isRecord(raw) || typeof raw.mode !== "string" || typeof raw.distance_meters !== "number") {
      throw new LocationSourceError("malformed", "Unexpected move in location response.");
    }
    return {
      start: timestamp(raw.start),
      end: timestamp(raw.end),
      mode: raw.mode,
      distanceMeters: raw.distance_meters,
    };
  });
  return { stays, moves };
}
