export interface LocationSettings {
  /** Base URL of an overland-server instance, e.g. "https://overland.example.com". */
  baseUrl: string;
  /** Bearer token for the server's read API. */
  token: string;
}

export const DEFAULT_LOCATION_SETTINGS: LocationSettings = {
  baseUrl: "",
  token: "",
};

export function isLocationConfigured(settings: LocationSettings): boolean {
  return settings.baseUrl.trim() !== "" && settings.token.trim() !== "";
}
