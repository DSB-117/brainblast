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

const VERSION = "0.6.0";

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
