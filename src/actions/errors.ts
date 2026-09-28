export class ClipboardUnsupportedError extends Error {
  constructor() {
    super("Copying to the clipboard is not supported in this environment.");
    this.name = "ClipboardUnsupportedError";
  }
}
