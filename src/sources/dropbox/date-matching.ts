import { localDate } from "../../domain";
import type { LocalDate } from "../../domain";

// Camera Uploads names files as "YYYY-MM-DD HH.MM.SS.ext" (some clients use
// an underscore instead of a space, and some archival workflows rename the
// time separators to hyphens, e.g. "YYYY-MM-DD_HH-MM-SS.ext"). The date is
// the device's local date at capture time; it is read as-is, with no
// timezone conversion.
const CAMERA_UPLOAD_FILENAME = /^(\d{4}-\d{2}-\d{2})[ _]\d{2}[.\-]\d{2}[.\-]\d{2}/;

export function dateFromCameraUploadFilename(filename: string): LocalDate | undefined {
  const match = CAMERA_UPLOAD_FILENAME.exec(filename);
  if (!match) return undefined;
  try {
    return localDate(match[1]);
  } catch {
    return undefined;
  }
}

// client_modified/server_modified are UTC instants, not capture time.
// Converting via the platform's local timezone is the documented fallback
// for files that don't follow the Camera Upload naming convention.
export function dateFromUtcTimestamp(isoTimestamp: string): LocalDate {
  const date = new Date(isoTimestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return localDate(`${year}-${month}-${day}`);
}

export interface DropboxFileDateSource {
  readonly name: string;
  readonly client_modified: string;
  readonly server_modified: string;
}

export function resolveEntryDate(entry: DropboxFileDateSource): LocalDate {
  return (
    dateFromCameraUploadFilename(entry.name) ??
    dateFromUtcTimestamp(entry.client_modified ?? entry.server_modified)
  );
}
