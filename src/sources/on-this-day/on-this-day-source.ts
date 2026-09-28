import type { ContextItem, ContextSource, DailyContext } from "../../domain";
import { throwIfAborted } from "../dropbox/cancel";
import { pastYearCandidates } from "./date-candidates";
import type { DateCandidate } from "./date-candidates";
import { extractExcerpt } from "./excerpt";
import type { NoteHandle, VaultAccess } from "./vault-access";

export interface OnThisDayItemPayload {
  readonly path: string;
}

export interface OnThisDaySourceConfig {
  readonly id: string;
  readonly name: string;
  getYearsBack(): number;
  getExcerptHeading(): string;
}

function yearsAgoLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
}

function isResolved(
  entry: { candidate: DateCandidate; note: NoteHandle | undefined },
): entry is { candidate: DateCandidate; note: NoteHandle } {
  return entry.note !== undefined;
}

// Vault-wide filename resolution and note reads are the only I/O; date
// candidate generation and excerpt extraction are pure and tested separately.
export class OnThisDaySource implements ContextSource {
  readonly id: string;
  readonly name: string;

  constructor(
    private readonly config: OnThisDaySourceConfig,
    private readonly vault: VaultAccess,
  ) {
    this.id = config.id;
    this.name = config.name;
  }

  // Needs no auth/config to function — only the Vault, which is always present.
  isAvailable(): boolean {
    return true;
  }

  async getItems(context: DailyContext, signal: AbortSignal): Promise<ContextItem[]> {
    const heading = this.config.getExcerptHeading();
    const sourcePath = context.activeFile?.path ?? "";
    const resolved = pastYearCandidates(context.date, this.config.getYearsBack())
      .map((candidate) => ({
        candidate,
        note: this.vault.resolveDatedNote(candidate.fileName, sourcePath),
      }))
      .filter(isResolved);
    throwIfAborted(signal);
    // Reads are independent, so they run concurrently — Promise.all keeps
    // the result order matching `resolved` (nearest year first) regardless
    // of which read settles first.
    const items = await Promise.all(
      resolved.map(async ({ candidate, note }): Promise<ContextItem> => {
        const content = await this.vault.readNote(note);
        const excerpt = extractExcerpt(content, { heading });
        const payload: OnThisDayItemPayload = { path: note.path };
        return {
          id: `${this.id}:${note.path}`,
          sourceId: this.id,
          type: "note",
          title: candidate.fileName.replace(/\.md$/, ""),
          subtitle: excerpt.length > 0 ? excerpt : undefined,
          groupLabel: yearsAgoLabel(candidate.yearsAgo),
          payload,
        };
      }),
    );
    throwIfAborted(signal);
    return items;
  }
}
