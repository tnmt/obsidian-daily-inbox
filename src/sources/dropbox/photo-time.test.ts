import { describe, expect, it } from "vitest";
import { formatPhotoTime } from "./photo-time";

describe("formatPhotoTime", () => {
  it("reads the local capture time from a Camera Uploads filename", () => {
    expect(formatPhotoTime("2026-09-23 12.34.56.jpg")).toBe("12:34");
  });

  it("accepts the underscore variant of the Camera Uploads filename", () => {
    expect(formatPhotoTime("2026-09-23_08.05.00.jpg")).toBe("08:05");
  });

  it("falls back to the local time of the timestamp when the filename has no time", () => {
    const ts = new Date(2026, 8, 23, 7, 8, 0);
    expect(formatPhotoTime("IMG_0001.jpg", ts)).toBe("07:08");
  });

  it("returns undefined when neither filename nor timestamp yields a time", () => {
    expect(formatPhotoTime("IMG_0001.jpg")).toBeUndefined();
    expect(formatPhotoTime("IMG_0001.jpg", new Date(NaN))).toBeUndefined();
  });

  it("prefers filename time over timestamp when both are present", () => {
    const ts = new Date(2026, 8, 23, 7, 8, 0);
    expect(formatPhotoTime("2026-09-23 12.34.56.jpg", ts)).toBe("12:34");
  });
});
