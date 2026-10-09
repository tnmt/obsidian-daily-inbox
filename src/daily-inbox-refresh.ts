import { DailyContextService } from "./daily-context-service";
import type { SourceResult } from "./daily-context-service";
import type { ContextItem, ContextSource, DailyContext } from "./domain";

/** How the view presents one source; the wording is view-level, not part of the ContextSource contract. */
export interface SourceSection {
  readonly source: ContextSource;
  readonly emptyMessage: string;
  /** Caveat shown under the section whenever it has loaded, e.g. a known gap in what the source can see. */
  readonly note?: string;
  describeUnavailable(): string;
  describeError(err: unknown): string;
}

export type SectionState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "items"; readonly items: ContextItem[] }
  | { readonly kind: "error"; readonly message: string };

function toSectionState(section: SourceSection, result: SourceResult): SectionState {
  switch (result.kind) {
    case "unavailable":
      return { kind: "unavailable", message: section.describeUnavailable() };
    case "items":
      return { kind: "items", items: result.items };
    case "error":
      return { kind: "error", message: section.describeError(result.error) };
  }
}

/** Runs one refresh at a time: starting a refresh or cancelling aborts every source request of the previous one. */
export class DailyInboxRefresher {
  private readonly service: DailyContextService;
  private readonly sectionsBySource: ReadonlyMap<ContextSource, SourceSection>;
  private controller?: AbortController;

  constructor(
    readonly sections: readonly SourceSection[],
    private readonly onSectionChange: (section: SourceSection, state: SectionState) => void,
  ) {
    this.service = new DailyContextService(sections.map((section) => section.source));
    this.sectionsBySource = new Map(sections.map((section) => [section.source, section]));
  }

  async refresh(context: DailyContext): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    for (const section of this.sections) this.onSectionChange(section, { kind: "loading" });
    await this.service.query(context, controller.signal, (source, result) => {
      const section = this.sectionsBySource.get(source);
      if (section) this.onSectionChange(section, toSectionState(section, result));
    });
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
  }
}

export function partitionItems(items: readonly ContextItem[]): {
  images: ContextItem[];
  others: ContextItem[];
} {
  const images: ContextItem[] = [];
  const others: ContextItem[] = [];
  for (const item of items) (item.type === "image" ? images : others).push(item);
  return { images, others };
}
