import type { LocalDate } from "../../domain";
import { WithingsSourceError } from "./errors";
import type { MeasureGroup } from "./client";

// Weight and body composition, heart rate, and PWV plus vascular age arrive
// as separate groups of one weigh-in; groups closer together than this belong
// to the same session.
export const SESSION_GAP_SECONDS = 30 * 60;

interface MetricFormat {
  readonly type: number;
  readonly label: string;
  readonly unit: string;
  readonly digits: number;
}

// Display order. Other measure types (fat mass, hydration, ...) are not shown.
const METRICS: readonly MetricFormat[] = [
  { type: 1, label: "Weight", unit: "kg", digits: 1 },
  { type: 6, label: "Fat", unit: "%", digits: 1 },
  { type: 76, label: "Muscle", unit: "kg", digits: 1 },
  { type: 91, label: "PWV", unit: "m/s", digits: 1 },
  { type: 11, label: "HR", unit: "bpm", digits: 0 },
  { type: 155, label: "Vascular age", unit: "", digits: 0 },
];

export interface MeasurementSession {
  /** Unix seconds of the first group in the session. */
  readonly startUnix: number;
  /** Wall-clock time in the account's zone, e.g. "07:12". */
  readonly time: string;
  /** e.g. "Weight 55.7kg / Fat 15.7% / Muscle 44.4kg / PWV 6.0m/s". */
  readonly summary: string;
}

interface ZonedParts {
  readonly date: string;
  readonly time: string;
}

function zonedParts(unixSeconds: number, timezone: string): ZonedParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(unixSeconds * 1000));
  } catch (err) {
    throw new WithingsSourceError("malformed", `Unknown time zone in Withings response: ${timezone}`, err);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Groups the date's measurements into weigh-in sessions, oldest first. */
export function buildSessions(groups: readonly MeasureGroup[], timezone: string, date: LocalDate): MeasurementSession[] {
  const onDate = groups
    .filter((g) => zonedParts(g.date, timezone).date === date)
    .sort((a, b) => a.date - b.date);

  const clusters: MeasureGroup[][] = [];
  for (const group of onDate) {
    const last = clusters[clusters.length - 1];
    if (last && group.date - last[last.length - 1].date <= SESSION_GAP_SECONDS) last.push(group);
    else clusters.push([group]);
  }

  const sessions: MeasurementSession[] = [];
  for (const cluster of clusters) {
    // Groups are chronological, so a later value of the same type wins.
    const latest = new Map<number, number>();
    for (const group of cluster) {
      for (const measure of group.measures) latest.set(measure.type, measure.value);
    }
    const summary = METRICS.filter((m) => latest.has(m.type))
      .map((m) => `${m.label} ${latest.get(m.type)!.toFixed(m.digits)}${m.unit}`)
      .join(" / ");
    if (summary === "") continue;
    sessions.push({
      startUnix: cluster[0].date,
      time: zonedParts(cluster[0].date, timezone).time,
      summary,
    });
  }
  return sessions;
}

/** Local calendar day as Unix seconds: [start of the day, start of the next day - 1]. */
export function localDayRange(date: LocalDate): { startUnix: number; endUnix: number } {
  const [year, month, day] = date.split("-").map(Number);
  return {
    startUnix: Math.floor(new Date(year, month - 1, day).getTime() / 1000),
    endUnix: Math.floor(new Date(year, month - 1, day + 1).getTime() / 1000) - 1,
  };
}
