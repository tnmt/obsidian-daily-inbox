import type { TFile } from "obsidian";

/** A calendar date in the user's local calendar, represented without a time zone. */
export type LocalDate = string & { readonly __localDate: unique symbol };

export function localDate(value: string): LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid local date: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`Invalid local date: ${value}`);
  }
  return value as LocalDate;
}

export interface DailyContext {
  readonly date: LocalDate;
  readonly activeFile?: TFile;
}

export interface ContextSource {
  readonly id: string;
  readonly name: string;
  isAvailable(): boolean;
  getItems(context: DailyContext, signal: AbortSignal): Promise<ContextItem[]>;
}

export type ContextItemType = "image" | "link" | "note" | "activity";

export interface ContextItem {
  readonly id: string;
  readonly sourceId: string;
  readonly type: ContextItemType;
  readonly timestamp?: Date;
  readonly title?: string;
  readonly subtitle?: string;
  readonly thumbnail?: string;
  /** Optional visual grouping hint for the view (e.g. a domain heading). Items should arrive pre-sorted so consecutive equal values render as one group. */
  readonly groupLabel?: string;
  readonly payload: unknown;
}

export interface ContextAction {
  readonly id: string;
  canHandle(item: ContextItem): boolean;
  run(item: ContextItem, context: DailyContext, signal: AbortSignal): Promise<void>;
}

export interface DateResolver {
  resolve(file?: TFile | null): LocalDate | undefined;
}

export class FileNameDateResolver implements DateResolver {
  resolve(file?: TFile | null): LocalDate | undefined {
    if (!file) return undefined;
    const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(file.name);
    if (!match) return undefined;
    try {
      return localDate(match[1]);
    } catch {
      return undefined;
    }
  }
}
