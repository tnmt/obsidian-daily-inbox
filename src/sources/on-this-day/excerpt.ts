export interface ExcerptOptions {
  readonly heading: string;
  readonly maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 240;

/**
 * Plain-text excerpt of the section under `heading` (matched as an exact
 * trimmed line, e.g. "## 📝 Journal"), stopping at the next heading of equal
 * or higher level. Falls back to the start of the note body (frontmatter
 * stripped) when the heading is absent.
 */
export function extractExcerpt(content: string, options: ExcerptOptions): string {
  const heading = options.heading.trim();
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const lines = content.split(/\r?\n/);
  // An empty heading can't match a line and must fall through to the body
  // fallback below — without this, `line.trim() === ""` would match the
  // note's first blank line, and the section-end check (which derives its
  // level from the heading's "#" prefix) would never fire for level 0.
  const headingIndex = heading.length === 0 ? -1 : lines.findIndex((line) => line.trim() === heading);
  const bodyLines = headingIndex === -1 ? stripFrontmatter(lines) : sectionAfter(lines, headingIndex, heading);
  const text = bodyLines.join(" ").replace(/\s+/g, " ").trim();
  return truncate(text, maxLength);
}

function sectionAfter(lines: string[], headingIndex: number, heading: string): string[] {
  const level = (/^#+/.exec(heading) ?? [""])[0].length;
  const rest = lines.slice(headingIndex + 1);
  const endIndex = rest.findIndex((line) => {
    const match = /^(#+)\s/.exec(line.trim());
    return match !== null && match[1].length <= level;
  });
  return endIndex === -1 ? rest : rest.slice(0, endIndex);
}

function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== "---") return lines;
  const closingOffset = lines.slice(1).findIndex((line) => line.trim() === "---");
  return closingOffset === -1 ? lines : lines.slice(closingOffset + 2);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}
