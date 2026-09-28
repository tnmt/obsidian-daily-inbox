import { describe, expect, it } from "vitest";
import { FileNameDateResolver } from "./domain";

function file(name: string) {
  return { name } as never;
}

describe("FileNameDateResolver", () => {
  const resolver = new FileNameDateResolver();

  it.each([["2026-09-23.md", "2026-09-23"], ["2026-09-24.md", "2026-09-24"]])(
    "resolves %s",
    (name, date) => expect(resolver.resolve(file(name))).toBe(date),
  );
  it.each(["foo.md", "2026-9-23.md", "2026-02-30.md"])(
    "does not resolve %s",
    (name) => expect(resolver.resolve(file(name))).toBeUndefined(),
  );
  it("does not use today when there is no active file", () => {
    expect(resolver.resolve()).toBeUndefined();
  });
});
