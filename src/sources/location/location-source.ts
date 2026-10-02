import type { ContextItem, ContextSource, DailyContext } from "../../domain";
import type { HttpRequester } from "../dropbox/http";
import type { ActivityTextPayload } from "../../actions/copy-activity-text";
import { fetchDay } from "./client";
import { formatDistance, formatDuration, formatMode, formatTimeRange } from "./format";
import { isLocationConfigured } from "./settings";
import type { LocationSettings } from "./settings";

export const UNNAMED_PLACE = "Unnamed place";

export class LocationSource implements ContextSource {
  readonly id = "location";
  readonly name = "Location";

  constructor(
    private readonly http: HttpRequester,
    private readonly getSettings: () => LocationSettings,
  ) {}

  isAvailable(): boolean {
    return isLocationConfigured(this.getSettings());
  }

  async getItems(context: DailyContext, signal: AbortSignal): Promise<ContextItem[]> {
    const { baseUrl, token } = this.getSettings();
    const day = await fetchDay(this.http, baseUrl, token, context.date, signal);

    const items: ContextItem[] = [];
    for (const stay of day.stays) {
      const range = formatTimeRange(stay.start, stay.end, context.date);
      const title = stay.placeName ?? UNNAMED_PLACE;
      const payload: ActivityTextPayload = { text: `${range} ${title}` };
      items.push({
        id: `${this.id}:stay:${stay.start}`,
        sourceId: this.id,
        type: "activity",
        timestamp: new Date(stay.start),
        title,
        subtitle: `${range} · ${formatDuration(stay.start, stay.end)}`,
        payload,
      });
    }
    for (const move of day.moves) {
      const range = formatTimeRange(move.start, move.end, context.date);
      const title = formatMode(move.mode);
      const distance = formatDistance(move.distanceMeters);
      const payload: ActivityTextPayload = { text: `${range} ${title} ${distance}` };
      items.push({
        id: `${this.id}:move:${move.start}`,
        sourceId: this.id,
        type: "activity",
        timestamp: new Date(move.start),
        title: `${title} · ${distance}`,
        subtitle: `${range} · ${formatDuration(move.start, move.end)}`,
        payload,
      });
    }
    // Array.prototype.sort is stable, so a stay and a move starting at the
    // same instant keep stays first.
    return items.sort((a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0));
  }
}
