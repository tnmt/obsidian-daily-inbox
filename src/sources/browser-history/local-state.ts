export interface DetectedProfile {
  readonly directoryName: string;
  readonly displayName: string;
}

interface LocalStateShape {
  profile?: {
    info_cache?: Record<string, { name?: string }>;
  };
}

// Best-effort settings-UI convenience, not part of the core data path:
// malformed/missing Local State just means no profiles are auto-detected,
// falling back to the settings tab's custom path field.
export function parseLocalStateProfiles(localStateJsonText: string): DetectedProfile[] {
  let parsed: LocalStateShape;
  try {
    parsed = JSON.parse(localStateJsonText) as LocalStateShape;
  } catch {
    return [];
  }
  const infoCache = parsed.profile?.info_cache;
  if (!infoCache || typeof infoCache !== "object") return [];
  return Object.entries(infoCache)
    .map(([directoryName, info]) => ({
      directoryName,
      displayName: info?.name?.trim() || directoryName,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
