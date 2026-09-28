// Camera Uploads names files as "YYYY-MM-DD HH.MM.SS.ext" (some clients use
// an underscore instead of a space, and some archival workflows rename the
// time separators to hyphens, e.g. "YYYY-MM-DD_HH-MM-SS.ext"). The time is
// the device's local time at capture, so it is preferred over client_modified
// for display and ordering.
const CAMERA_UPLOAD_TIME = /^\d{4}-\d{2}-\d{2}[ _](\d{2})[.\-](\d{2})[.\-](\d{2})/;

export interface PhotoTime {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

export function photoTime(name: string, timestamp?: Date): PhotoTime | undefined {
  const match = CAMERA_UPLOAD_TIME.exec(name);
  if (match) return { hours: Number(match[1]), minutes: Number(match[2]), seconds: Number(match[3]) };
  if (timestamp && !Number.isNaN(timestamp.getTime())) {
    return { hours: timestamp.getHours(), minutes: timestamp.getMinutes(), seconds: timestamp.getSeconds() };
  }
  return undefined;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatPhotoTime(name: string, timestamp?: Date): string | undefined {
  const time = photoTime(name, timestamp);
  return time ? `${pad2(time.hours)}:${pad2(time.minutes)}` : undefined;
}

function secondsOfDay(time: PhotoTime | undefined): number {
  return time ? time.hours * 3600 + time.minutes * 60 + time.seconds : Number.POSITIVE_INFINITY;
}

/** Orders photos by capture time, earliest first; photos without a known time go last, and ties fall back to the filename. */
export function comparePhotosByTime(
  a: { readonly name: string; readonly timestamp?: Date },
  b: { readonly name: string; readonly timestamp?: Date },
): number {
  const diff = secondsOfDay(photoTime(a.name, a.timestamp)) - secondsOfDay(photoTime(b.name, b.timestamp));
  if (diff !== 0 && !Number.isNaN(diff)) return diff;
  return a.name.localeCompare(b.name);
}
