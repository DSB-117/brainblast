// OSV.dev API client — shared by the diff command and the MCP server.
// https://google.github.io/osv.dev/post-v1-query/

export interface OsvAdvisory {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  summary: string;
  url: string;
}

function mapSeverity(vuln: Record<string, unknown>): OsvAdvisory["severity"] {
  const severities = (vuln["severity"] as Array<{ type: string; score: string }> | undefined) ?? [];
  for (const sev of severities) {
    if (sev.type === "CVSS_V3") {
      const score = parseFloat(sev.score);
      if (!isNaN(score)) {
        if (score >= 9.0) return "critical";
        if (score >= 7.0) return "high";
        if (score >= 4.0) return "medium";
        return "low";
      }
    }
  }
  const dbSpec = (vuln["database_specific"] as Record<string, string> | undefined) ?? {};
  const ghsa = (dbSpec["severity"] ?? "").toUpperCase();
  const map: Record<string, OsvAdvisory["severity"]> = {
    CRITICAL: "critical",
    HIGH: "high",
    MODERATE: "medium",
    LOW: "low",
  };
  return map[ghsa] ?? "high";
}

export async function queryOsv(
  ecosystem: string,
  name: string,
  version: string,
): Promise<OsvAdvisory[]> {
  const body = JSON.stringify({ version, package: { name, ecosystem } });
  let res: Response;
  try {
    res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: unknown) {
    throw new Error(`OSV API request failed: ${(e as Error).message ?? String(e)}`);
  }
  if (!res.ok) throw new Error(`OSV API error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { vulns?: Array<Record<string, unknown>> };
  return (data.vulns ?? []).map((v) => {
    const id = v["id"] as string;
    const rawSummary = (v["summary"] as string | undefined) ?? "";
    const rawDetails = (v["details"] as string | undefined) ?? "";
    return {
      id,
      severity: mapSeverity(v),
      summary: rawSummary || rawDetails.slice(0, 200),
      url: `https://osv.dev/vulnerability/${id}`,
    };
  });
}
