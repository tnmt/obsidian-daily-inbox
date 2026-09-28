import { describe, expect, it } from "vitest";
import { comparePhotosByTime, formatPhotoTime } from "./photo-time";

describe("formatPhotoTime", () => {
  it("reads the local capture time from a Camera Uploads filename", () => {
    expect(formatPhotoTime("2026-09-23 12.34.56.jpg")).toBe("12:34");
  });

  it("accepts the underscore variant of the Camera Uploads filename", () => {
    expect(formatPhotoTime("2026-09-23_08.05.00.jpg")).toBe("08:05");
  });

  it("accepts hyphen-separated time in an archived Camera Uploads filename", () => {
    expect(formatPhotoTime("2023-09-29_19-50-17.jpg")).toBe("19:50");
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

describe("comparePhotosByTime", () => {
  const sortNames = (photos: Array<{ name: string; timestamp?: Date }>) =>
    [...photos].sort(comparePhotosByTime).map((p) => p.name);

  it("orders by filename capture time across separator variants", () => {
    expect(
      sortNames([
        { name: "2023-09-29_19-50-17.jpg" },
        { name: "2023-09-29 11.28.00.jpg" },
        { name: "2023-09-29_19.45.02.jpg" },
      ]),
    ).toEqual(["2023-09-29 11.28.00.jpg", "2023-09-29_19.45.02.jpg", "2023-09-29_19-50-17.jpg"]);
  });

  it("uses the timestamp's local time for filenames without a time", () => {
    expect(
      sortNames([
        { name: "IMG_0002.jpg", timestamp: new Date(2023, 8, 29, 15, 0, 0) },
        { name: "2023-09-29 12.32.00.jpg", timestamp: new Date(2023, 8, 29, 23, 0, 0) },
      ]),
    ).toEqual(["2023-09-29 12.32.00.jpg", "IMG_0002.jpg"]);
  });

  it("puts photos without a known time last, ordered by name", () => {
    expect(sortNames([{ name: "b.jpg" }, { name: "a.jpg" }, { name: "2023-09-29 23.53.00.jpg" }])).toEqual([
      "2023-09-29 23.53.00.jpg",
      "a.jpg",
      "b.jpg",
    ]);
  });
});
