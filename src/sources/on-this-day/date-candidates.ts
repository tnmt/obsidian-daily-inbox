import type { LocalDate } from "../../domain";

export interface DateCandidate {
  readonly year: number;
  /**
   * Year offset from the context date. Negative = past (e.g. -1 means "1 year
   * ago"), positive = future (e.g. +1 means "1 year later"). Never 0 — the
   * context date's own year is excluded.
   */
  readonly offset: number;
  readonly fileName: string;
}

const DAILY_NOTE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.md$/;

/**
 * Picks the vault's `YYYY-MM-DD.md` filenames whose MM-DD matches `date` but
 * whose year is different, and returns them past-first (nearest year ago →
 * furthest ago) then future (nearest year later → furthest later). Callers
 * pass the full daily-note filename list; the filter is done here so the
 * matching rule stays testable without a Vault.
 */
export function sameDateCandidates(date: LocalDate, fileNames: readonly string[]): DateCandidate[] {
  const [year, month, day] = date.split("-").map(Number);
  const past: DateCandidate[] = [];
  const future: DateCandidate[] = [];
  // Same-named notes in different folders all resolve to one file via link
  // resolution, so duplicates would render the same note twice.
  for (const fileName of new Set(fileNames)) {
    const match = DAILY_NOTE_PATTERN.exec(fileName);
    if (!match) continue;
    const fileYear = Number(match[1]);
    const fileMonth = Number(match[2]);
    const fileDay = Number(match[3]);
    if (fileMonth !== month || fileDay !== day) continue;
    if (fileYear === year) continue;
    const offset = fileYear - year;
    (offset < 0 ? past : future).push({ year: fileYear, offset, fileName });
  }
  past.sort((a, b) => b.year - a.year);
  future.sort((a, b) => a.year - b.year);
  return [...past, ...future];
}
