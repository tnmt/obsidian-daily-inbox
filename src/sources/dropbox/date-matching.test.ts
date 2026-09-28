import { describe, expect, it } from "vitest";
import {
  dateFromCameraUploadFilename,
  dateFromUtcTimestamp,
  resolveEntryDate,
} from "./date-matching";

describe("dateFromCameraUploadFilename", () => {
  it.each([
    ["2026-09-23 12.34.56.jpg", "2026-09-23"],
    ["2026-09-23_12.34.56.jpg", "2026-09-23"],
    ["2026-01-01 00.00.00.png", "2026-01-01"],
  ])("extracts the date from %s", (name, expected) => {
    expect(dateFromCameraUploadFilename(name)).toBe(expected);
  });

  it.each(["IMG_20260923.jpg", "photo.jpg", "2026-9-23 12.34.56.jpg", "2026-13-01 12.34.56.jpg"])(
    "returns undefined for %s",
    (name) => {
      expect(dateFromCameraUploadFilename(name)).toBeUndefined();
    },
  );
});

describe("dateFromUtcTimestamp", () => {
  it("converts a UTC instant to the local calendar date", () => {
    // Interpreted in whatever timezone the test runner uses; the important
    // property is that it goes through Date's local getters rather than the
    // UTC ones, so it lines up with LocalDate elsewhere in the domain.
    const date = new Date("2026-09-23T12:00:00Z");
    const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    expect(dateFromUtcTimestamp("2026-09-23T12:00:00Z")).toBe(expected);
  });
});

describe("resolveEntryDate", () => {
  it("prefers the filename convention over metadata timestamps", () => {
    expect(
      resolveEntryDate({
        name: "2026-09-23 12.34.56.jpg",
        client_modified: "2026-09-24T00:00:00Z",
        server_modified: "2026-09-24T00:00:00Z",
      }),
    ).toBe("2026-09-23");
  });

  it("falls back to client_modified when the filename doesn't match", () => {
    const result = resolveEntryDate({
      name: "IMG_20260923.jpg",
      client_modified: "2026-09-23T12:00:00Z",
      server_modified: "2026-09-25T00:00:00Z",
    });
    expect(result).toBe(dateFromUtcTimestamp("2026-09-23T12:00:00Z"));
  });

  it("falls back to server_modified when client_modified is absent", () => {
    const result = resolveEntryDate({
      name: "IMG_20260923.jpg",
      client_modified: undefined as unknown as string,
      server_modified: "2026-09-25T00:00:00Z",
    });
    expect(result).toBe(dateFromUtcTimestamp("2026-09-25T00:00:00Z"));
  });
});
