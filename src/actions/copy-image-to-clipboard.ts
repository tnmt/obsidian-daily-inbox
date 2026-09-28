import type { ContextAction, ContextItem, DailyContext } from "../domain";

export interface OriginalImageFetcher {
  canFetch(item: ContextItem): boolean;
  fetchOriginal(item: ContextItem, signal: AbortSignal): Promise<ArrayBuffer>;
}

export interface ImageClipboard {
  writePng(png: Promise<Blob>): Promise<void>;
}

export type PngEncoder = (image: Blob) => Promise<Blob>;

export class ClipboardUnsupportedError extends Error {
  constructor() {
    super("Copying images to the clipboard is not supported in this environment.");
    this.name = "ClipboardUnsupportedError";
  }
}

export class ImageDecodeError extends Error {
  constructor(public readonly cause?: unknown) {
    super("The photo could not be decoded for the clipboard.");
    this.name = "ImageDecodeError";
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, PNG_SIGNATURE.length));
  return head.length === PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => head[i] === b);
}

// Browsers' async clipboard only accepts image/png for images, so other
// formats (camera JPEGs in practice) are re-encoded before writing.
export class CopyImageToClipboardAction implements ContextAction {
  readonly id = "copy-image-to-clipboard";

  constructor(
    private readonly fetcher: OriginalImageFetcher,
    private readonly getClipboard: () => ImageClipboard | undefined,
    private readonly encodePng: PngEncoder,
  ) {}

  canHandle(item: ContextItem): boolean {
    return item.type === "image" && this.fetcher.canFetch(item);
  }

  // clipboard.write() must be called synchronously within the click's user
  // activation (Safari/iOS rejects it after an await), so the image is passed
  // as a pending Promise<Blob> rather than awaited first.
  run(item: ContextItem, _context: DailyContext, signal: AbortSignal): Promise<void> {
    const clipboard = this.getClipboard();
    if (!clipboard) return Promise.reject(new ClipboardUnsupportedError());
    const png = this.fetcher.fetchOriginal(item, signal).then((bytes) => {
      if (isPng(bytes)) return new Blob([bytes], { type: "image/png" });
      return this.encodePng(new Blob([bytes]));
    });
    // A failed download/encode also fails write(); report the underlying
    // cause (auth, cancellation, decode) instead of the clipboard's error.
    return clipboard.writePng(png).then(
      () => undefined,
      async (writeError: unknown) => {
        await png;
        throw writeError;
      },
    );
  }
}

export function getBrowserImageClipboard(): ImageClipboard | undefined {
  if (typeof ClipboardItem === "undefined" || typeof navigator?.clipboard?.write !== "function") {
    return undefined;
  }
  const supports = (ClipboardItem as { supports?: (type: string) => boolean }).supports;
  if (supports && !supports("image/png")) return undefined;
  return {
    writePng: (png) => navigator.clipboard.write([new ClipboardItem({ "image/png": png })]),
  };
}

export async function encodePngWithCanvas(image: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch (err) {
    throw new ImageDecodeError(err);
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageDecodeError();
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageDecodeError())), "image/png");
    });
  } finally {
    bitmap.close();
  }
}
