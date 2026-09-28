import { describe, expect, it } from "vitest";
import { extractDomain, groupAndCollapseVisits, isDomainExcluded, type RawVisit } from "./group-and-collapse";

describe("extractDomain", () => {
  it("returns the hostname of a valid URL", () => {
    expect(extractDomain("https://www.example.com/path?x=1")).toBe("www.example.com");
  });

  it("returns undefined for an unparseable URL", () => {
    expect(extractDomain("not a url")).toBeUndefined();
  });
});

describe("isDomainExcluded", () => {
  it("matches the exact domain", () => {
    expect(isDomainExcluded("example.com", ["example.com"])).toBe(true);
  });

  it("matches a subdomain via suffix match", () => {
    expect(isDomainExcluded("www.example.com", ["example.com"])).toBe(true);
    expect(isDomainExcluded("mail.example.com", ["example.com"])).toBe(true);
  });

  it("does not match an unrelated domain that merely contains the excluded string", () => {
    expect(isDomainExcluded("notexample.com", ["example.com"])).toBe(false);
    expect(isDomainExcluded("example.com.attacker.net", ["example.com"])).toBe(false);
  });

  it("matches regardless of case, and ignores a trailing dot", () => {
    expect(isDomainExcluded("example.com", ["Example.COM"])).toBe(true);
    expect(isDomainExcluded("www.example.com", ["EXAMPLE.com"])).toBe(true);
    expect(isDomainExcluded("example.com.", ["example.com"])).toBe(true);
  });
});

function visit(overrides: Partial<RawVisit> = {}): RawVisit {
  return { url: "https://a.example/page", title: "Page", timestamp: new Date("2026-09-23T09:00:00Z"), ...overrides };
}

describe("groupAndCollapseVisits", () => {
  it("groups visits by domain, sorted alphabetically", () => {
    const groups = groupAndCollapseVisits(
      [visit({ url: "https://b.example/x", title: "X" }), visit({ url: "https://a.example/y", title: "Y" })],
      [],
    );
    expect(groups.map((g) => g.domain)).toEqual(["a.example", "b.example"]);
  });

  it("collapses repeated visits to the same URL, keeping a count and the latest timestamp", () => {
    const groups = groupAndCollapseVisits(
      [
        visit({ timestamp: new Date("2026-09-23T09:00:00Z") }),
        visit({ timestamp: new Date("2026-09-23T14:00:00Z") }),
        visit({ timestamp: new Date("2026-09-23T10:00:00Z") }),
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].visits).toHaveLength(1);
    expect(groups[0].visits[0].visitCount).toBe(3);
    expect(groups[0].visits[0].lastVisit).toEqual(new Date("2026-09-23T14:00:00Z"));
  });

  it("sorts visits within a group by most recent first", () => {
    const groups = groupAndCollapseVisits(
      [
        visit({ url: "https://a.example/older", timestamp: new Date("2026-09-23T08:00:00Z") }),
        visit({ url: "https://a.example/newer", timestamp: new Date("2026-09-23T18:00:00Z") }),
      ],
      [],
    );
    expect(groups[0].visits.map((v) => v.url)).toEqual(["https://a.example/newer", "https://a.example/older"]);
  });

  it("filters out excluded domains and unparseable URLs", () => {
    const groups = groupAndCollapseVisits(
      [
        visit({ url: "https://excluded.example/x" }),
        visit({ url: "not a url" }),
        visit({ url: "https://kept.example/y" }),
      ],
      ["excluded.example"],
    );
    expect(groups.map((g) => g.domain)).toEqual(["kept.example"]);
  });
});
