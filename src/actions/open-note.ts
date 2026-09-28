import type { ContextAction, ContextItem, DailyContext } from "../domain";

export interface NotePayload {
  readonly path: string;
}

export interface NoteOpener {
  open(path: string): Promise<void>;
}

// Matched by item type, not sourceId, so any future note-typed source gets
// this action for free.
export class OpenNoteAction implements ContextAction {
  readonly id = "open-note";

  constructor(private readonly opener: NoteOpener) {}

  canHandle(item: ContextItem): boolean {
    return item.type === "note";
  }

  async run(item: ContextItem, _context: DailyContext, _signal: AbortSignal): Promise<void> {
    const { path } = item.payload as NotePayload;
    await this.opener.open(path);
  }
}
