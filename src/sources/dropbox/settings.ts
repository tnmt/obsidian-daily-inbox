export interface DropboxSettings {
  clientId: string;
  folderPaths: string[];
}

export const DEFAULT_DROPBOX_SETTINGS: DropboxSettings = {
  clientId: "",
  folderPaths: ["/Camera Uploads"],
};

// Pre-#20 installs persisted a single `folderPath: string`. Converts that
// shape into `folderPaths` so existing configurations survive the upgrade
// instead of silently reverting to the default folder. Also drops a
// `folderPaths` that isn't actually a string array (e.g. corrupted by a
// vault-sync conflict) so main.ts's `{...DEFAULT_DROPBOX_SETTINGS,
// ...migrated}` merge falls back to the default instead of assigning a
// non-array value that would throw the first time it's used.
export function migrateDropboxSettings(raw: unknown): Partial<DropboxSettings> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const legacy = raw as Partial<DropboxSettings> & { folderPath?: string };
  const { folderPath, folderPaths, ...rest } = legacy;
  if (Array.isArray(folderPaths) && folderPaths.every((path) => typeof path === "string")) {
    return { ...rest, folderPaths };
  }
  if (typeof folderPath === "string") {
    return { ...rest, folderPaths: [folderPath] };
  }
  return rest;
}
