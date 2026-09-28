// Camera Uploads names files as "YYYY-MM-DD HH.MM.SS.ext" (some clients use
// an underscore instead of a space, and some archival workflows rename the
// time separators to hyphens, e.g. "YYYY-MM-DD_HH-MM-SS.ext"). The time is
// the device's local time at capture, so it is preferred over client_modified
// for display.
const CAMERA_UPLOAD_TIME = /^\d{4}-\d{2}-\d{2}[ _](\d{2})[.\-](\d{2})[.\-]\d{2}/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatPhotoTime(name: string, timestamp?: Date): string | undefined {
  const match = CAMERA_UPLOAD_TIME.exec(name);
  if (match) return `${match[1]}:${match[2]}`;
  if (timestamp && !Number.isNaN(timestamp.getTime())) {
    return `${pad2(timestamp.getHours())}:${pad2(timestamp.getMinutes())}`;
  }
  return undefined;
}
