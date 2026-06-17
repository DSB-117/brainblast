import { Project, SyntaxKind } from "ts-morph";
import { walk } from "./walk.ts";

// ── Rent formula ────────────────────────────────────────────────────────────
//
// Solana rent-exemption minimum (current mainnet parameters):
//   LAMPORTS_PER_BYTE_YEAR = 3480
//   EXEMPTION_THRESHOLD    = 2 years
//   OVERHEAD               = 128 bytes (account metadata)
//
//   rent_exempt_minimum = (data_len + 128) * 3480 * 2
//                       = (data_len + 128) * 6960 lamports
//
// Verified against known values:
//   SPL Token account (165 bytes): (165 + 128) * 6960 = 2,039,280 lamports ✓
//   SPL Mint (82 bytes):           (82  + 128) * 6960 = 1,461,600 lamports ✓

const LAMPORTS_PER_BYTE_YEAR = 3480;
const EXEMPTION_THRESHOLD = 2;
const OVERHEAD_BYTES = 128;
const LAMPORTS_PER_SOL = 1_000_000_000;

export function rentExemptMinimum(dataLen: number): number {
  return (dataLen + OVERHEAD_BYTES) * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_THRESHOLD;
}

export function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, "");
}

// ── Known account-creation flows ────────────────────────────────────────────

export type Recoverability = "recoverable" | "non-recoverable" | "conditionally-recoverable";

interface KnownFlow {
  call: string;
  module: string;
  accountType: string;
  dataLen: number;
  recoverability: Recoverability;
  recoverabilityNote: string;
}

// Data lengths sourced from official program source / Solana SPL docs.
const KNOWN_FLOWS: KnownFlow[] = [
  {
    call: "createMint",
    module: "@solana/spl-token",
    accountType: "SPL Token Mint",
    dataLen: 82,
    recoverability: "conditionally-recoverable",
    recoverabilityNote:
      "Recoverable via `closeAccount` on the mint — requires mint supply = 0 and mint authority disabled. Most production mints never meet these conditions.",
  },
  {
    call: "createAssociatedTokenAccount",
    module: "@solana/spl-token",
    accountType: "Associated Token Account (ATA)",
    dataLen: 165,
    recoverability: "recoverable",
    recoverabilityNote:
      "Recovered by calling `closeAccount`; lamports return to the destination wallet. Requires zero token balance.",
  },
  {
    call: "createAssociatedTokenAccountIdempotent",
    module: "@solana/spl-token",
    accountType: "Associated Token Account (ATA, idempotent)",
    dataLen: 165,
    recoverability: "recoverable",
    recoverabilityNote:
      "Recovered by calling `closeAccount`; lamports return to the destination wallet. Requires zero token balance.",
  },
  {
    call: "createAccount",
    module: "@solana/spl-token",
    accountType: "SPL Token Account (explicit)",
    dataLen: 165,
    recoverability: "recoverable",
    recoverabilityNote:
      "Recovered by calling `closeAccount`; lamports return to the destination wallet. Requires zero token balance.",
  },
  {
    call: "createV1",
    module: "@metaplex-foundation/mpl-token-metadata",
    accountType: "Metaplex Token Metadata",
    // Base metadata: 1(key) + 32(update_auth) + 32(mint) + 4+name + 4+symbol + 4+uri
    // + 2(seller_fee) + 1(creators opt) + 1(primary_sale) + 1(is_mutable) ≈ 679 bytes typical
    dataLen: 679,
    recoverability: "non-recoverable",
    recoverabilityNote:
      "Metaplex metadata accounts cannot be closed. The lamport lockup is permanent for the lifetime of the token.",
  },
  {
    call: "createNft",
    module: "@metaplex-foundation/mpl-token-metadata",
    accountType: "Metaplex NFT Metadata",
    dataLen: 679,
    recoverability: "non-recoverable",
    recoverabilityNote:
      "Metaplex metadata accounts cannot be closed. The lamport lockup is permanent.",
  },
  {
    call: "createAndMint",
    module: "@metaplex-foundation/mpl-token-metadata",
    accountType: "Metaplex Token Metadata + Mint",
    dataLen: 679 + 82, // metadata + mint
    recoverability: "non-recoverable",
    recoverabilityNote:
      "Metadata accounts cannot be closed. Mint rent is conditionally recoverable (requires 0 supply + disabled authority).",
  },
  {
    call: "createFungible",
    module: "@metaplex-foundation/mpl-token-metadata",
    accountType: "Metaplex Fungible Token Metadata",
    dataLen: 679,
    recoverability: "non-recoverable",
    recoverabilityNote:
      "Metaplex metadata accounts cannot be closed. The lamport lockup is permanent.",
  },
];

// ── Result types ─────────────────────────────────────────────────────────────

export interface AccountFlow {
  call: string;
  module: string;
  accountType: string;
  file: string;
  line: number;
  dataLen: number;
  lamports: number;
  sol: string;
  recoverability: Recoverability;
  recoverabilityNote: string;
  /** Call appears inside a loop or .map()/.forEach() — cost scales with N */
  scalable: boolean;
  scalableNote?: string;
}

export interface PriorityFeePosture {
  /** true = setComputeUnitPrice call detected somewhere in the target */
  found: boolean;
  file?: string;
  line?: number;
  detail: string;
}

export interface CostReport {
  accountFlows: AccountFlow[];
  priorityFee: PriorityFeePosture;
  /** Sum of lamports across non-scalable flows (static lower bound) */
  totalLockupLamports: number;
  totalLockupSol: string;
  /** Subset of flows that grow with N */
  scalableFlows: AccountFlow[];
  generatedAt: string;
}

// ── Loop-context detection ───────────────────────────────────────────────────

const LOOP_NODE_KINDS = new Set([
  SyntaxKind.ForStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
]);

const ARRAY_METHOD_LOOPS = new Set(["map", "forEach", "flatMap", "reduce", "filter"]);

function isInsideLoop(node: ReturnType<typeof import("ts-morph").Project.prototype.createSourceFile>["getFirstChild"]): { scalable: boolean; note?: string } {
  let cur: any = node;
  while (cur) {
    const k = cur.getKind?.();
    if (k !== undefined && LOOP_NODE_KINDS.has(k)) {
      return { scalable: true, note: `call is inside a ${SyntaxKind[k]} — cost scales with loop iterations` };
    }
    // Check for .map()/.forEach() call expression parent
    if (k === SyntaxKind.CallExpression) {
      const expr = cur.getExpression?.();
      if (expr?.getKind?.() === SyntaxKind.PropertyAccessExpression) {
        const name = expr.asKind?.(SyntaxKind.PropertyAccessExpression)?.getName?.();
        if (name && ARRAY_METHOD_LOOPS.has(name)) {
          return { scalable: true, note: `call is inside .${name}() — cost scales with array length` };
        }
      }
    }
    cur = cur.getParent?.();
  }
  return { scalable: false };
}

// ── Priority-fee detector ────────────────────────────────────────────────────

function detectPriorityFee(targetDir: string): PriorityFeePosture {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  for (const file of walk(targetDir)) {
    const sf = project.addSourceFileAtPath(file);
    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const ce of calls) {
      const expr = ce.getExpression();
      const text = expr.getText();
      // Match ComputeBudgetProgram.setComputeUnitPrice or standalone setComputeUnitPrice
      if (text.includes("setComputeUnitPrice")) {
        return {
          found: true,
          file,
          line: ce.getStartLineNumber(),
          detail: `ComputeBudgetProgram.setComputeUnitPrice detected at ${file}:${ce.getStartLineNumber()} — priority fee configured.`,
        };
      }
    }
  }
  return {
    found: false,
    detail:
      "No setComputeUnitPrice call detected. During network congestion, transactions without a priority fee may stall or be dropped. Add ComputeBudgetProgram.setComputeUnitPrice() to critical transaction paths.",
  };
}

// ── Account-flow detector ────────────────────────────────────────────────────

function detectAccountFlows(targetDir: string): AccountFlow[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const callIndex = new Map(KNOWN_FLOWS.map((f) => [f.call, f]));
  const flows: AccountFlow[] = [];

  for (const file of walk(targetDir)) {
    const sf = project.addSourceFileAtPath(file);

    // Build module import set for scope gating: only flag a call if the module
    // that exports it is actually imported by this file.
    const importedModules = new Set(
      sf.getImportDeclarations().map((d) => d.getModuleSpecifierValue()),
    );

    for (const ce of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = ce.getExpression();

      // Resolve the bare function name from foo(), obj.foo(), or obj?.foo()
      let callName: string | null = null;
      if (expr.getKind() === SyntaxKind.Identifier) {
        callName = expr.getText();
      } else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        callName = expr.asKind(SyntaxKind.PropertyAccessExpression)!.getName();
      }

      if (!callName) continue;
      const known = callIndex.get(callName);
      if (!known) continue;

      // Scope gate: file must import the module that owns this call
      if (!importedModules.has(known.module)) continue;

      const lamports = rentExemptMinimum(known.dataLen);
      const { scalable, note } = isInsideLoop(ce as any);

      flows.push({
        call: callName,
        module: known.module,
        accountType: known.accountType,
        file,
        line: ce.getStartLineNumber(),
        dataLen: known.dataLen,
        lamports,
        sol: lamportsToSol(lamports),
        recoverability: known.recoverability,
        recoverabilityNote: known.recoverabilityNote,
        scalable,
        scalableNote: note,
      });
    }
  }

  return flows;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function analyzeCosts(targetDir: string): CostReport {
  const accountFlows = detectAccountFlows(targetDir);
  const priorityFee = detectPriorityFee(targetDir);

  const staticFlows = accountFlows.filter((f) => !f.scalable);
  const scalableFlows = accountFlows.filter((f) => f.scalable);
  const totalLockupLamports = staticFlows.reduce((s, f) => s + f.lamports, 0);

  return {
    accountFlows,
    priorityFee,
    totalLockupLamports,
    totalLockupSol: lamportsToSol(totalLockupLamports),
    scalableFlows,
    generatedAt: new Date().toISOString(),
  };
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

export function renderCostReportMd(r: CostReport): string {
  const lines: string[] = ["## Cost & Rent Analysis\n"];

  // Priority fee posture
  if (r.priorityFee.found) {
    lines.push(`✅ **Priority fee configured** — \`setComputeUnitPrice\` detected.`);
    lines.push(`   ${r.priorityFee.detail}\n`);
  } else {
    lines.push(`⚠️  **HIGH — Priority fee not configured**`);
    lines.push(`   ${r.priorityFee.detail}\n`);
  }

  if (r.accountFlows.length === 0) {
    lines.push("_No account-creation calls from tracked modules detected._\n");
    return lines.join("\n");
  }

  // Account flows table
  lines.push("### Account Creation Flows\n");
  lines.push("| Call | Account Type | Data | Lamports Locked | SOL | Recoverable? |");
  lines.push("|------|-------------|------|-----------------|-----|--------------|");

  for (const f of r.accountFlows) {
    const file = f.file.split("/").slice(-2).join("/");
    const recov =
      f.recoverability === "recoverable"
        ? "✅ Yes"
        : f.recoverability === "conditionally-recoverable"
          ? "⚠️  Conditional"
          : "❌ No";
    const scaleMark = f.scalable ? " 🔄" : "";
    lines.push(
      `| \`${f.call}\`${scaleMark} (${file}:${f.line}) | ${f.accountType} | ${f.dataLen} B | ${f.lamports.toLocaleString()} | ${f.sol} SOL | ${recov} |`,
    );
  }
  lines.push("");

  // Recoverability notes
  const unique = new Map<string, string>();
  for (const f of r.accountFlows) unique.set(f.accountType, f.recoverabilityNote);
  lines.push("**Recoverability notes:**");
  for (const [type, note] of unique) lines.push(`- **${type}:** ${note}`);
  lines.push("");

  // Total
  if (r.totalLockupLamports > 0) {
    lines.push(
      `**Total static lockup: ${r.totalLockupLamports.toLocaleString()} lamports (~${r.totalLockupSol} SOL)**`,
    );
    lines.push(
      `_(Excludes ${r.scalableFlows.length} scalable flow(s) whose cost grows with N — see below.)_\n`,
    );
  }

  // Scalable flows
  if (r.scalableFlows.length > 0) {
    lines.push("### Scalable Cost Flows (cost grows with N)\n");
    for (const f of r.scalableFlows) {
      const file = f.file.split("/").slice(-2).join("/");
      lines.push(
        `- **\`${f.call}\`** at \`${file}:${f.line}\` — ${f.scalableNote}` +
          `\n  Per-iteration cost: ${f.lamports.toLocaleString()} lamports (${f.sol} SOL) for each ${f.accountType}.`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
