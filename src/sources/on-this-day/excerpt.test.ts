import { describe, expect, it } from "vitest";
import { extractExcerpt } from "./excerpt";

describe("extractExcerpt", () => {
  it("extracts the section under the heading, stopping at the next same-level heading", () => {
    const content = [
      "# Daily Note",
      "",
      "## 📝 Journal",
      "Had a good day. Went for a walk.",
      "",
      "## Tasks",
      "- buy milk",
    ].join("\n");
    expect(extractExcerpt(content, { heading: "## 📝 Journal" })).toBe("Had a good day. Went for a walk.");
  });

  it("keeps nested subheadings inside the matched section", () => {
    const content = ["## 📝 Journal", "### Morning", "Coffee.", "## Tasks", "later"].join("\n");
    expect(extractExcerpt(content, { heading: "## 📝 Journal" })).toBe("### Morning Coffee.");
  });

  it("reads to the end of the note when there is no following heading", () => {
    const content = ["## 📝 Journal", "Line one.", "Line two."].join("\n");
    expect(extractExcerpt(content, { heading: "## 📝 Journal" })).toBe("Line one. Line two.");
  });

  it("falls back to the body start, stripping frontmatter, when the heading is absent", () => {
    const content = ["---", "created: 2025-09-27", "---", "", "First paragraph text."].join("\n");
    expect(extractExcerpt(content, { heading: "## 📝 Journal" })).toBe("First paragraph text.");
  });

  it("falls back to the body start when there is no frontmatter either", () => {
    const content = ["Just some text.", "More text."].join("\n");
    expect(extractExcerpt(content, { heading: "## 📝 Journal" })).toBe("Just some text. More text.");
  });

  it("falls back to the body start when the heading is an empty string, rather than matching the first blank line", () => {
    const content = ["First paragraph text.", "", "## Tasks", "- buy milk"].join("\n");
    expect(extractExcerpt(content, { heading: "" })).toBe("First paragraph text. ## Tasks - buy milk");
  });

  it("truncates long excerpts with an ellipsis", () => {
    const content = `## 📝 Journal\n${"a".repeat(300)}`;
    expect(extractExcerpt(content, { heading: "## 📝 Journal", maxLength: 10 })).toBe(`${"a".repeat(10)}…`);
  });
});
