import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { OriginalImageFetcher } from "./actions/copy-image-to-clipboard";
import type { ContextItem } from "./domain";

export class ImagePreviewModal extends Modal {
  private readonly controller = new AbortController();
  private objectUrl?: string;
  private copying = false;
  private closed = false;

  constructor(
    app: App,
    private readonly item: ContextItem,
    private readonly fetcher: OriginalImageFetcher,
    // Invoked synchronously from the click/keydown so the clipboard write
    // starts inside the user activation.
    private readonly onCopy: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const label = this.item.title ?? this.item.id;
    this.modalEl.addClass("daily-inbox-preview-modal");
    this.contentEl.empty();

    const frame = this.contentEl.createDiv({
      cls: "daily-inbox-preview-frame",
      attr: { role: "button", tabindex: "0", "aria-label": `Copy ${label} to the clipboard` },
    });
    if (this.item.thumbnail) {
      const img = frame.createEl("img", { cls: "daily-inbox-preview-image" });
      img.src = this.item.thumbnail;
      img.alt = label;
    } else {
      frame.createDiv({ cls: "daily-inbox-photo-fallback", text: "No preview" });
    }
    frame.addEventListener("click", () => this.copy());
    frame.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      this.copy();
    });

    const caption = this.contentEl.createDiv({ cls: "daily-inbox-preview-caption" });
    caption.createDiv({ text: label });
    if (this.item.subtitle) caption.createDiv({ text: this.item.subtitle });
    const status = caption.createDiv({ cls: "daily-inbox-preview-status", text: "Loading full-size photo…" });

    this.fetcher.fetchOriginal(this.item, this.controller.signal).then(
      (bytes) => {
        if (this.closed) return;
        status.setText("Click the photo to copy it.");
        this.showOriginal(frame, label, bytes);
      },
      () => {
        if (this.closed) return;
        status.setText("Could not load the full-size photo. Click to copy anyway.");
      },
    );
    frame.focus();
  }

  onClose(): void {
    this.closed = true;
    // Once a copy has started it awaits the same cached download, so it must
    // not be cancelled by closing the preview.
    if (!this.copying) this.controller.abort();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.contentEl.empty();
  }

  private copy(): void {
    this.copying = true;
    this.onCopy();
    this.close();
  }

  // Formats Electron cannot decode (e.g. HEIC) fail to load; the thumbnail
  // or placeholder stays in place instead.
  private showOriginal(frame: HTMLElement, label: string, bytes: ArrayBuffer): void {
    const url = URL.createObjectURL(new Blob([bytes]));
    this.objectUrl = url;
    const original = new Image();
    original.className = "daily-inbox-preview-image";
    original.alt = label;
    original.onload = () => {
      frame.empty();
      frame.appendChild(original);
    };
    original.src = url;
  }
}
