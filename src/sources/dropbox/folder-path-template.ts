import type { LocalDate } from "../../domain";

// Lets a configured path track a per-year archive layout (e.g.
// "/Pictures/Archive/{year}") without the user adding a new folder entry
// every year. LocalDate is already "YYYY-MM-DD", so the year is its first
// four characters.
export function expandFolderPathTemplate(template: string, date: LocalDate): string {
  return template.split("{year}").join(date.slice(0, 4));
}

// Trims, drops blanks, expands `{year}`, and dedupes (case-insensitively —
// Dropbox folder paths are case-insensitive, see client.ts's use of
// `path_lower`, so two entries differing only in case address the same
// folder and would otherwise be queried and merged in twice) while
// preserving configuration order, so callers get a clean list of concrete
// paths to search.
export function resolveConfiguredFolderPaths(
  rawPaths: readonly string[],
  date: LocalDate,
): string[] {
  const resolved = new Map<string, string>();
  for (const raw of rawPaths) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const expanded = expandFolderPathTemplate(trimmed, date);
    const key = expanded.toLowerCase();
    if (!resolved.has(key)) resolved.set(key, expanded);
  }
  return [...resolved.values()];
}
