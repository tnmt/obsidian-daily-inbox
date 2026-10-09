export interface WithingsSettings {
  /** Client ID of the Withings application the user registered for themselves. */
  clientId: string;
  clientSecret: string;
}

export const DEFAULT_WITHINGS_SETTINGS: WithingsSettings = {
  clientId: "",
  clientSecret: "",
};

export function hasWithingsCredentials(settings: WithingsSettings): boolean {
  return settings.clientId.trim() !== "" && settings.clientSecret.trim() !== "";
}
