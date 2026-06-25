import { createRequire } from "node:module";
import { readdirSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, statSync, readFileSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { Project, ts, type CompilerOptions } from "ts-morph";
import type { OracleBackend, OracleVerdict, OracleTarget } from "../types.ts";
import type { Rule } from "../../types.ts";

// Tier 1 — the COMPILER oracle. The cheapest, highest-volume catch on the
// roadmap: code that doesn't type-check against the pinned SDK. The #1 agent
// error is calling an API that doesn't exist / moved at a given version
// (`stripe.paymentIntent.create` instead of `stripe.paymentIntents.create`).
// No static pattern scales to every such mistake; the compiler already knows
// all of them.
//
// RED→GREEN: the trap is "uses an API that doesn't exist / is mis-typed against
// sdk@version." The vulnerable fixture, compiled against the REAL installed SDK,
// FAILS to type-check (RED). The fixed fixture type-checks clean (GREEN). The
// compiler's own diagnostics are the proof and the reproducibility receipt.
//
// NEVER runs the program. The type-checker reads source + .d.ts; it does not
// execute user logic. Offline, deterministic (pinned SDK + pinned tsc → identical
// diagnostics), no network, no LLM. Safe in BOTH the local and ingest contexts.

const requireFrom = createRequire(import.meta.url);

// `compiles-against-sdk` is the only kind this backend owns. params:
//   { sdk: string, version?: string, expectError?: boolean }
function supports(rule: Rule): boolean {
  return rule.check?.kind === "compiles-against-sdk" && rule.detect?.lang !== "rust";
}

// Resolve where the pinned SDK is installed so we can type-check against it.
// We return the directory that CONTAINS its node_modules, so a scratch dir placed
// under it resolves the same pinned version by ordinary node module resolution.
function resolveSdkRoot(sdk: string): { nmParent: string; version: string } | null {
  // Resolve the SDK's package.json path (preferred — gives us both the install
  // location and the pinned version). Fall back to the entry point.
  let pkgJsonPath: string | null = null;
  let resolved: string;
  try {
    pkgJsonPath = requireFrom.resolve(`${sdk}/package.json`);
    resolved = pkgJsonPath;
  } catch {
    try {
      resolved = requireFrom.resolve(sdk);
    } catch {
      return null;
    }
  }
  // Walk up from the resolved file to the nearest `node_modules` segment.
  const parts = resolved.split(sep);
  const nmIdx = parts.lastIndexOf("node_modules");
  if (nmIdx <= 0) return null;
  const nmParent = parts.slice(0, nmIdx).join(sep) || sep;

  // The pinned version IS the freshness signal: when the SDK bumps and the
  // fixture starts/stops compiling, the drift surfaces here.
  let version = "unknown";
  if (!pkgJsonPath) {
    // Reconstruct the package dir from the resolved entry to find its package.json.
    pkgJsonPath = join(parts.slice(0, nmIdx + 2).join(sep), "package.json");
  }
  try {
    version = JSON.parse(readFileSync(pkgJsonPath, "utf8")).version ?? "unknown";
  } catch {
    /* version is best-effort */
  }
  return { nmParent, version };
}

function copyTsTree(srcDir: string, destDir: string): string[] {
  const copied: string[] = [];
  const walk = (cur: string) => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const abs = join(cur, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const rel = relative(srcDir, abs);
        const dest = join(destDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(abs, dest);
        copied.push(dest);
      }
    }
  };
  if (statSync(srcDir).isDirectory()) walk(srcDir);
  return copied;
}

const COMPILER_OPTS: CompilerOptions = {
  noEmit: true,
  skipLibCheck: true, // we judge the CANDIDATE, not the SDK's own .d.ts
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  strict: false,
  noImplicitAny: false,
  types: [], // do not auto-pull @types/* — keep the surface deterministic
  forceConsistentCasingInFileNames: false,
};

export const compilerBackend: OracleBackend = {
  method: "compiler",
  tier: 1,
  supports,
  async verify({ dir, rule }: OracleTarget): Promise<OracleVerdict> {
    const t0 = Date.now();
    const sdk = String(rule.check?.params?.sdk ?? "");
    if (!sdk) {
      return unknown("rule is missing check.params.sdk — cannot pick a compile target", t0);
    }
    const root = resolveSdkRoot(sdk);
    if (!root) {
      return unknown(
        `SDK '${sdk}' is not installed where the candidate can resolve it; ` +
          `install it (the pinned version) and re-run --oracle=compiler.`,
        t0,
      );
    }

    const scratch = mkdtempSync(join(root.nmParent, ".brainblast-oracle-"));
    try {
      const copied = copyTsTree(dir, scratch);
      if (copied.length === 0) {
        return unknown(`no TypeScript candidate files found under ${dir}`, t0);
      }

      const project = new Project({
        compilerOptions: COMPILER_OPTS,
        skipAddingFilesFromTsConfig: true,
      });
      project.addSourceFilesAtPaths(join(scratch, "**/*.{ts,tsx,mts,cts}"));

      const diags = project
        .getPreEmitDiagnostics()
        .filter((d) => d.getCategory() === ts.DiagnosticCategory.Error)
        .filter((d) => d.getSourceFile()?.getFilePath()?.startsWith(scratch));

      const tsVersion = ts.version;
      if (diags.length === 0) {
        return {
          color: "GREEN",
          method: "compiler",
          detail: `type-checks clean against ${sdk}@${root.version} (tsc ${tsVersion}).`,
          evidence: { sdk, sdkVersion: root.version, tsVersion, diagnostics: 0 },
          durationMs: Date.now() - t0,
        };
      }

      const first = diags[0];
      const sf = first.getSourceFile();
      const fileRel = sf ? relative(scratch, sf.getFilePath()) : "(unknown)";
      const line = sf && first.getStart() != null ? sf.getLineAndColumnAtPos(first.getStart()!).line : undefined;
      const rawMsg = first.getMessageText();
      const msg =
        typeof rawMsg === "string"
          ? rawMsg
          : ts.flattenDiagnosticMessageText(rawMsg.compilerObject, "\n");
      return {
        color: "RED",
        method: "compiler",
        detail:
          `does not type-check against ${sdk}@${root.version}: TS${first.getCode()} ` +
          `in ${fileRel}${line ? `:${line}` : ""} — ${msg}`,
        evidence: {
          sdk,
          sdkVersion: root.version,
          tsVersion,
          diagnostics: diags.length,
          code: `TS${first.getCode()}`,
          file: fileRel,
          line,
          message: msg,
        },
        durationMs: Date.now() - t0,
      };
    } catch (e: any) {
      return unknown(`compiler oracle could not run: ${e?.message ?? String(e)}`, t0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};

function unknown(detail: string, t0: number): OracleVerdict {
  return { color: "UNKNOWN", method: "compiler", detail, durationMs: Date.now() - t0 };
}
