import type { LocalDate } from "../../domain";

export interface DateCandidate {
  readonly year: number;
  readonly yearsAgo: number;
  readonly fileName: string;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Candidate past-year Daily Note filenames for `date`, nearest year first.
 * Feb 29 only ever matches a leap year — non-leap years are skipped rather
 * than falling back to Feb 28.
 */
export function pastYearCandidates(date: LocalDate, yearsBack: number): DateCandidate[] {
  const [year, month, day] = date.split("-").map(Number);
  const candidates: DateCandidate[] = [];
  for (let yearsAgo = 1; yearsAgo <= yearsBack; yearsAgo++) {
    const candidateYear = year - yearsAgo;
    if (month === 2 && day === 29 && !isLeapYear(candidateYear)) continue;
    candidates.push({
      year: candidateYear,
      yearsAgo,
      fileName: `${pad(candidateYear, 4)}-${pad(month, 2)}-${pad(day, 2)}.md`,
    });
  }
  return candidates;
}
