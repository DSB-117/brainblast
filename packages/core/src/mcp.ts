// MCP server — exposes brainblast tools over the Model Context Protocol.
//
//   brainblast mcp
//
// Starts a stdio MCP server. Add to Claude Code's MCP config:
//
//   {
//     "mcpServers": {
//       "brainblast": {
//         "command": "npx",
//         "args": ["brainblast@latest", "mcp"]
//       }
//     }
//   }
//
// Tools exposed:
//   brainblast_audit       — run the static auditor on a local directory
//   brainblast_diff        — compare OSV risk profile between two package versions
//   brainblast_osv_check   — query OSV.dev for advisories on one version
//   brainblast_verify      — PROVE a fix: re-run a pack's RED→GREEN through the oracle

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { audit } from "./audit.ts";
import { resolveRules } from "./resolveRules.ts";
import { queryOsv } from "./osv.ts";
import { diffVersions } from "./diff.ts";

const VERSION = "0.9.0";

const TOOLS: Tool[] = [
  {
    name: "brainblast_audit",
    description:
      "Run the brainblast deterministic static auditor on a local project directory. " +
      "Returns per-rule check results (pass / fail / cant_tell) and severity totals. " +
      "Catches catastrophic AI-integration traps: Stripe raw-body signing, JWT audience/issuer, " +
      "SPL token-program identity, command-injection sinks, committed secrets, and more.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dir: {
          type: "string",
          description:
            "Absolute path to the project directory to audit. " +
            "Defaults to the current working directory if omitted.",
        },
        packs: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of absolute paths to pluggable rule-pack directories " +
            "(each must contain a brainblast-pack.yaml manifest).",
        },
      },
      required: [],
    },
  },
  {
    name: "brainblast_diff",
    description:
      "Compare the OSV security-advisory risk profile between two versions of a package. " +
      "Shows which advisories were introduced by the upgrade, which were resolved, " +
      "and which are present in both versions. Returns a risk score: positive means " +
      "the upgrade increases risk, negative means it decreases risk.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ecosystem: {
          type: "string",
          description:
            "OSV ecosystem name — e.g. npm, PyPI, crates.io, Go, RubyGems, Packagist, Maven, NuGet.",
        },
        package: { type: "string", description: "Package / module name." },
        from_version: { type: "string", description: "The version currently in use (upgrading from)." },
        to_version: { type: "string", description: "The candidate version (upgrading to)." },
      },
      required: ["ecosystem", "package", "from_version", "to_version"],
    },
  },
  {
    name: "brainblast_osv_check",
    description:
      "Query OSV.dev for all known security advisories affecting a specific package at a specific version. " +
      "Returns severity (critical/high/medium/low), advisory ID, human-readable summary, and advisory URL. " +
      "An empty array means no advisories found — not that the package is safe.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ecosystem: {
          type: "string",
          description: "OSV ecosystem — e.g. npm, PyPI, crates.io, Go, RubyGems.",
        },
        package: { type: "string", description: "Package name." },
        version: { type: "string", description: "Exact version string to check." },
      },
      required: ["ecosystem", "package", "version"],
    },
  },
  {
    name: "brainblast_verify",
    description:
      "PROVE a fix, don't just flag it. Re-run a brainblast rule pack's records through the " +
      "generalized oracle (v0.9.0) and report which reproduce RED→GREEN — the vulnerable fixture " +
      "verifies RED, the fixed fixture verifies GREEN. Offline Tier-0/1 backends (static, compiler) " +
      "run by default with no code execution; Tier-2 (executed/differential) need an explicit opt-in " +
      "and land fully in v0.9.1. This is the reproducibility receipt: the same procedure, re-runnable " +
      "by anyone, returns the same color — no secret answer key.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dir: {
          type: "string",
          description:
            "Absolute path to a rule-pack directory (containing brainblast-pack.yaml, rules/, and " +
            "fixtures/<rule-id>/{vulnerable,fixed}/).",
        },
        trapId: {
          type: "string",
          description: "Optional rule id to verify just one record; omit to verify the whole pack.",
        },
        oracle: {
          type: "string",
          description:
            "Which backend(s): static | compiler | executed | differential | best. Default best " +
            "(tries each allowed backend in trust order and records the strongest proof).",
        },
      },
      required: ["dir"],
    },
  },
];

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "brainblast", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    if (name === "brainblast_audit") {
      const { dir = process.cwd(), packs = [] } = args as { dir?: string; packs?: string[] };
      try {
        const rules = resolveRules(dir, packs as string[]);
        const { checks, report } = audit(dir, rules);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  dir,
                  rulesLoaded: rules.length,
                  checks,
                  riskTotals: report.riskTotals,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running audit: ${(e as Error).message ?? String(e)}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (name === "brainblast_osv_check") {
      const { ecosystem, package: pkg, version } = args as {
        ecosystem: string;
        package: string;
        version: string;
      };
      try {
        const advisories = await queryOsv(ecosystem, pkg, version);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(advisories, null, 2),
            },
          ],
        };
      } catch (e: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `OSV query failed: ${(e as Error).message ?? String(e)}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (name === "brainblast_verify") {
      const { dir, trapId, oracle = "best" } = args as { dir: string; trapId?: string; oracle?: string };
      try {
        const { existsSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { loadPack } = await import("./packs.ts");
        const { selectBackends, parseOracleSelector } = await import("./oracle/index.ts");
        const { proveWithBest, proofMethod } = await import("./oracle/prove.ts");

        const { backends } = selectBackends(parseOracleSelector(oracle));
        const pack = loadPack(dir);
        const targets = trapId ? pack.rules.filter((r) => r.id === trapId) : pack.rules;
        if (targets.length === 0) {
          throw new Error(trapId ? `no rule '${trapId}' in pack ${pack.manifest.id}` : `pack ${pack.manifest.id} has no rules`);
        }
        const rows = [];
        for (const rule of targets) {
          const base = join(dir, "fixtures", rule.id);
          const vulnerableDir = join(base, "vulnerable");
          const fixedDir = join(base, "fixed");
          if (!existsSync(vulnerableDir) || !existsSync(fixedDir)) {
            rows.push({ ruleId: rule.id, reproduced: false, method: null, detail: "missing fixtures" });
            continue;
          }
          const result = await proveWithBest(backends, vulnerableDir, fixedDir, rule);
          rows.push({
            ruleId: rule.id,
            reproduced: !!result.proven,
            method: result.proven ? proofMethod(result) : null,
            detail: result.proven
              ? `RED→GREEN reproduced via ${proofMethod(result)}`
              : result.attempts.map((a) => `${a.method}: red=${a.red} green=${a.green}`).join("; "),
          });
        }
        const reproduced = rows.filter((r) => r.reproduced).length;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ pack: pack.manifest.id, oracle, reproduced, total: rows.length, rows }, null, 2),
            },
          ],
        };
      } catch (e: unknown) {
        return {
          content: [{ type: "text" as const, text: `Verify failed: ${(e as Error).message ?? String(e)}` }],
          isError: true,
        };
      }
    }

    if (name === "brainblast_diff") {
      const { ecosystem, package: pkg, from_version, to_version } = args as {
        ecosystem: string;
        package: string;
        from_version: string;
        to_version: string;
      };
      try {
        const result = await diffVersions(ecosystem, pkg, from_version, to_version);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Diff failed: ${(e as Error).message ?? String(e)}`,
            },
          ],
          isError: true,
        };
      }
    }

    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
