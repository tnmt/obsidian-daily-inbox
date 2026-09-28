export interface NoteHandle {
  readonly path: string;
}

/** Vault-facing seam so this source's lookup logic is testable without a real Obsidian App. */
export interface VaultAccess {
  /** Every markdown file in the vault whose name is `YYYY-MM-DD.md`. Path is not needed here — resolveDatedNote turns the name into a handle. */
  listDailyNoteFileNames(): string[];
  /**
   * Resolves a note by exact filename (e.g. "2025-09-27.md") using
   * Obsidian's own link-resolution rules, so it works regardless of which
   * folder the note lives in. Returns undefined when no markdown note with
   * that name exists.
   */
  resolveDatedNote(fileName: string, sourcePath: string): NoteHandle | undefined;
  readNote(note: NoteHandle): Promise<string>;
}
