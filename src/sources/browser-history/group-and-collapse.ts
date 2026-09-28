export interface RawVisit {
  readonly url: string;
  readonly title: string;
  readonly timestamp: Date;
}

export interface CollapsedVisit {
  readonly url: string;
  readonly title: string;
  readonly visitCount: number;
  readonly lastVisit: Date;
}

export interface DomainGroup {
  readonly domain: string;
  readonly visits: CollapsedVisit[];
}

export function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// Hostnames from URL.hostname are always lowercase; user-typed exclude-list
// entries are not, so both sides are normalized before comparing (also
// trimming a trailing dot, a valid but rarely-typed hostname terminator).
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

// Suffix match: excluding "example.com" also excludes "www.example.com" and
// "mail.example.com" (subdomains), but not "notexample.com".
export function isDomainExcluded(domain: string, excludeList: readonly string[]): boolean {
  const normalizedDomain = normalizeHost(domain);
  return excludeList.some((entry) => {
    const normalizedEntry = normalizeHost(entry);
    return normalizedDomain === normalizedEntry || normalizedDomain.endsWith(`.${normalizedEntry}`);
  });
}

export function groupAndCollapseVisits(
  visits: readonly RawVisit[],
  excludedDomains: readonly string[],
): DomainGroup[] {
  const byDomain = new Map<string, Map<string, CollapsedVisit>>();

  for (const visit of visits) {
    const domain = extractDomain(visit.url);
    if (!domain || isDomainExcluded(domain, excludedDomains)) continue;

    let byUrl = byDomain.get(domain);
    if (!byUrl) {
      byUrl = new Map();
      byDomain.set(domain, byUrl);
    }

    const existing = byUrl.get(visit.url);
    if (!existing) {
      byUrl.set(visit.url, { url: visit.url, title: visit.title, visitCount: 1, lastVisit: visit.timestamp });
    } else if (visit.timestamp > existing.lastVisit) {
      byUrl.set(visit.url, { ...existing, visitCount: existing.visitCount + 1, lastVisit: visit.timestamp });
    } else {
      byUrl.set(visit.url, { ...existing, visitCount: existing.visitCount + 1 });
    }
  }

  return Array.from(byDomain.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, byUrl]) => ({
      domain,
      visits: Array.from(byUrl.values()).sort((a, b) => b.lastVisit.getTime() - a.lastVisit.getTime()),
    }));
}
