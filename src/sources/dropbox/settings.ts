export interface DropboxSettings {
  clientId: string;
  folderPath: string;
}

export const DEFAULT_DROPBOX_SETTINGS: DropboxSettings = {
  clientId: "",
  folderPath: "/Camera Uploads",
};
