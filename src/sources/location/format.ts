import type { LocalDate } from "../../domain";

// The server reports times in the time zone that defines its calendar days,
// so the wall-clock part of each RFC 3339 string is read as is rather than
// converted to this machine's zone; otherwise a stay could appear to fall on
// a different date than the one the server returned it for.
function wallClock(ts: string): { date: string; time: string } {
  return { date: ts.slice(0, 10), time: ts.slice(11, 16) };
}

/** e.g. "09:39–11:15", or "09-29 22:15–08:44" when an end lies on another date. */
export function formatTimeRange(start: string, end: string, date: LocalDate): string {
  const s = wallClock(start);
  const e = wallClock(end);
  const label = (part: { date: string; time: string }) =>
    part.date === date ? part.time : `${part.date.slice(5)} ${part.time}`;
  return `${label(s)}–${label(e)}`;
}

/** e.g. "45m", "2h", "1h36m". */
export function formatDuration(start: string, end: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/** e.g. "0.5 km", "12 km". */
export function formatDistance(meters: number): string {
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

const MODE_LABELS: Readonly<Record<string, string>> = {
  WALKING: "Walk",
  RUNNING: "Run",
  CYCLING: "Bike",
  IN_PASSENGER_VEHICLE: "Car",
  IN_BUS: "Bus",
  IN_TRAIN: "Train",
  IN_SUBWAY: "Subway",
  IN_TRAM: "Tram",
  IN_FERRY: "Ferry",
  FLYING: "Flight",
};

/** Google Timeline activity types, with unknown ones made readable rather than dropped. */
export function formatMode(mode: string): string {
  const known = MODE_LABELS[mode];
  if (known) return known;
  const words = mode.replace(/^IN_/, "").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
