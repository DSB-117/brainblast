import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { rentExemptMinimum, lamportsToSol } from "./costAnalysis.ts";

// ── Deployment Intelligence ──────────────────────────────────────────────────
//
// Answers the two questions you otherwise work out by hand before shipping an
// Anchor program:
//
//   1. "How much SOL do I need to deploy this?"
//   2. "What's the exact ordered sequence of transactions?"
//
// The numbers come from the on-chain BPF *upgradeable* loader's account model,
// which is what `solana program deploy` / `anchor deploy` use by default.
//
// ── Account sizing (solana_sdk::bpf_loader_upgradeable::UpgradeableLoaderState)
//
//   size_of_program()          = 36                 // Program { programdata: Pubkey }
//   size_of_buffer(len)        = 37 + len           // Buffer  { authority: Option<Pubkey> } + bytes
//   size_of_programdata(len)   = 45 + len           // ProgramData { slot, upgrade_auth } + bytes
//
//   PROGRAMDATA_METADATA = 45, BUFFER_METADATA = 37, PROGRAM_SIZE = 36.
//
// On deploy, the CLI reserves headroom for future upgrades by allocating the
// programdata account at `max_len = program_len * 2` (the default). So the
// big, non-recoverable lockup is `rent(45 + 2 * program_len)`.
//
// Rent itself reuses the shared formula in costAnalysis.ts:
//   rent(data_len) = (data_len + 128) * 6960 lamports   (128 = account overhead)

const PROGRAM_ACCOUNT_SIZE = 36;
const PROGRAMDATA_METADATA = 45;
const BUFFER_METADATA = 37;

// Default upgrade headroom: `solana program deploy` sets max_len = 2 * len.
const DEFAULT_MAX_LEN_MULTIPLIER = 2;

// Program data is written to the buffer in chunks. The Solana CLI sizes each
// write so the transaction stays under the 1232-byte packet limit; in practice
// ~1012 bytes of program data fit per write transaction after instruction and
// signature overhead.
const WRITE_CHUNK_BYTES = 1012;

// Base transaction fee: 5000 lamports per signature. Deploy transactions carry
// a single fee-payer signature in the common case.
const BASE_TX_FEE_LAMPORTS = 5000;

// ── Anchor init-account parsing ───────────────────────────────────────────────

const _require = createRequire(import.meta.url);
let _parser: any = null;
function getParser(): any {
  if (_parser) return _parser;
  const Parser = _require("tree-sitter") as any;
  const Rust = _require("tree-sitter-rust") as any;
  _parser = new Parser();
  _parser.setLanguage(Rust);
  return _parser;
}

function walkRust(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "target") continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkRust(p, out);
    else if (p.endsWith(".rs")) out.push(p);
  }
  return out;
}

function named(node: any): any[] {
  const out: any[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c.isNamed) out.push(c);
  }
  return out;
}

/** (attribute_text[], item_node) pairs — attributes precede their item. */
function itemsWithAttrs(containerNode: any): Array<{ attrs: string[]; node: any }> {
  const result: Array<{ attrs: string[]; node: any }> = [];
  let pending: string[] = [];
  for (const kid of named(containerNode)) {
    if (kid.type === "attribute_item") pending.push(kid.text);
    else {
      result.push({ attrs: pending, node: kid });
      pending = [];
    }
  }
  return result;
}

export interface InitAccount {
  /** Field name on the Accounts struct, e.g. `treasury`. */
  name: string;
  /** Accounts struct it belongs to, e.g. `Initialize`. */
  struct: string;
  file: string;
  line: number;
  /** Anchor account type, e.g. `Account<'info, Treasury>`. */
  typeName: string;
  /** Declared `space = N` in bytes, or null when not a resolvable literal. */
  space: number | null;
  /** When space is non-literal (refs a const / INIT_SPACE), the raw expression. */
  spaceExpr?: string;
  /** Rent-exempt lamports for `space`, or null when space is unknown. */
  rentLamports: number | null;
  /** PDA seeds expression, or null for a plain (keypair) account. */
  seeds: string | null;
  /** `payer = X`, or null when not declared. */
  payer: string | null;
  /** init_if_needed (conditional creation). */
  conditional: boolean;
}

/**
 * Sum the integer literals in an Anchor `space = ...` expression.
 * `8 + 32 + 8` → { value: 48, literal: true }
 * `8 + Treasury::INIT_SPACE` → { value: 8, literal: false } (a partial floor)
 */
function evalSpaceExpr(expr: string): { value: number; literal: boolean } {
  const tokens = expr.split("+").map((t) => t.trim());
  let value = 0;
  let literal = true;
  for (const t of tokens) {
    if (/^\d+$/.test(t)) value += parseInt(t, 10);
    else if (t.length > 0) literal = false;
  }
  return { value, literal };
}

/** Extract `key = value` from an Anchor `#[account(...)]` attribute body. */
function attrValue(attrText: string, key: string): string | null {
  // Match `key = <value>` up to the next top-level comma or close paren.
  const re = new RegExp(`\\b${key}\\s*=\\s*`);
  const m = re.exec(attrText);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  let out = "";
  for (; i < attrText.length; i++) {
    const ch = attrText[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out.trim() || null;
}

function parseInitAccounts(targetDir: string): InitAccount[] {
  const parser = getParser();
  const accounts: InitAccount[] = [];

  for (const file of walkRust(targetDir)) {
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!src.includes("#[derive(Accounts)]") && !src.includes("Accounts)]")) continue;

    const tree = parser.parse(src);
    const root = tree.rootNode;

    // Find struct_item nodes preceded by #[derive(Accounts)].
    const topPairs = itemsWithAttrs(root);
    for (const { attrs, node } of topPairs) {
      if (node.type !== "struct_item") continue;
      const isAccounts = attrs.some((a) => a.includes("Accounts"));
      if (!isAccounts) continue;

      const nameNode = node.childForFieldName("name");
      const structName = nameNode?.text ?? "<anonymous>";
      const body = node.childForFieldName("body");
      if (!body) continue;

      for (const { attrs: fAttrs, node: fNode } of itemsWithAttrs(body)) {
        if (fNode.type !== "field_declaration") continue;
        const attrText = fAttrs.join("\n");
        // Only `init` / `init_if_needed` accounts cost rent at setup time.
        const hasInit = /\binit\b/.test(attrText) || /\binit_if_needed\b/.test(attrText);
        if (!hasInit) continue;

        const fieldName = fNode.childForFieldName("name")?.text ?? "?";
        const typeName = fNode.childForFieldName("type")?.text ?? "?";

        const spaceRaw = attrValue(attrText, "space");
        let space: number | null = null;
        let spaceExpr: string | undefined;
        if (spaceRaw) {
          const { value, literal } = evalSpaceExpr(spaceRaw);
          if (literal) space = value;
          else {
            space = null;
            spaceExpr = spaceRaw;
          }
        }

        accounts.push({
          name: fieldName,
          struct: structName,
          file,
          line: fNode.startPosition.row + 1,
          typeName,
          space,
          spaceExpr,
          rentLamports: space === null ? null : rentExemptMinimum(space),
          seeds: attrValue(attrText, "seeds"),
          payer: attrValue(attrText, "payer"),
          conditional: /\binit_if_needed\b/.test(attrText),
        });
      }
    }
  }
  return accounts;
}

// ── Compiled artifact discovery ───────────────────────────────────────────────

export interface ProgramBinary {
  path: string;
  bytes: number;
}

/** Locate the largest compiled `.so` under common Anchor/SBF output dirs. */
export function findProgramBinary(targetDir: string): ProgramBinary | null {
  const candidates = [
    join(targetDir, "target", "deploy"),
    join(targetDir, "target", "sbf-solana-solana", "release"),
    join(targetDir, "target", "bpfel-unknown-unknown", "release"),
  ];
  let best: ProgramBinary | null = null;
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".so")) continue;
      const p = join(dir, entry);
      const bytes = statSync(p).size;
      if (!best || bytes > best.bytes) best = { path: p, bytes };
    }
  }
  return best;
}

// ── Plan model ────────────────────────────────────────────────────────────────

export type StepKind = "create-buffer" | "write" | "deploy" | "initialize";

export interface DeployStep {
  index: number;
  kind: StepKind;
  label: string;
  /** Lamports of rent this step locks (non-recoverable while the account lives). */
  rentLamports: number;
  /** Lamports of transient rent (recoverable — e.g. buffer refunded on deploy). */
  transientLamports: number;
  /** Estimated transaction fees for this step. */
  feeLamports: number;
  detail: string;
}

export interface DeployPlan {
  binary: ProgramBinary | null;
  programLen: number | null;
  maxLenMultiplier: number;
  priorityMicroLamports: number;

  programAccountRent: number;
  programDataRent: number;
  bufferRent: number;
  writeTxCount: number;
  txFeeLamports: number;

  initAccounts: InitAccount[];
  initRentLamports: number;
  /** init accounts whose space couldn't be resolved to a literal. */
  unresolvedInit: InitAccount[];

  steps: DeployStep[];

  /** Steady-state lamports locked once deploy completes (program + data + init). */
  lockedLamports: number;
  /** Safe upper bound on wallet balance needed to run the full deploy. */
  walletRequiredLamports: number;

  generatedAt: string;
}

export interface DeployPlanOptions {
  /** Override the 2× upgrade-headroom multiplier for the programdata account. */
  maxLenMultiplier?: number;
  /** Priority fee in micro-lamports per compute unit (for fee estimate framing). */
  priorityMicroLamports?: number;
  /** Override program length (bytes) when no compiled .so is present. */
  programLen?: number;
}

export function buildDeployPlan(targetDir: string, opts: DeployPlanOptions = {}): DeployPlan {
  const maxLenMultiplier = opts.maxLenMultiplier ?? DEFAULT_MAX_LEN_MULTIPLIER;
  const priorityMicroLamports = opts.priorityMicroLamports ?? 0;

  const binary = opts.programLen != null ? null : findProgramBinary(targetDir);
  const programLen = opts.programLen ?? binary?.bytes ?? null;

  const initAccounts = parseInitAccounts(targetDir);
  const unresolvedInit = initAccounts.filter((a) => a.rentLamports === null);
  const initRentLamports = initAccounts.reduce((s, a) => s + (a.rentLamports ?? 0), 0);

  // Program-deploy economics. Without a known length we still emit the
  // structural sequence, but the rent figures are zeroed and flagged.
  const programAccountRent = programLen == null ? 0 : rentExemptMinimum(PROGRAM_ACCOUNT_SIZE);
  const programDataRent =
    programLen == null
      ? 0
      : rentExemptMinimum(PROGRAMDATA_METADATA + maxLenMultiplier * programLen);
  const bufferRent =
    programLen == null ? 0 : rentExemptMinimum(BUFFER_METADATA + programLen);
  const writeTxCount = programLen == null ? 0 : Math.ceil(programLen / WRITE_CHUNK_BYTES);

  // 1 create-buffer + N writes + 1 deploy + one tx per init instruction (grouped
  // by Accounts struct).
  const initStructs = [...new Set(initAccounts.map((a) => a.struct))];
  const baseTxCount = (programLen == null ? 0 : 2 + writeTxCount) + initStructs.length;
  const txFeeLamports = baseTxCount * BASE_TX_FEE_LAMPORTS;

  // ── Ordered transaction sequence ────────────────────────────────────────────
  const steps: DeployStep[] = [];
  let idx = 1;

  if (programLen != null) {
    steps.push({
      index: idx++,
      kind: "create-buffer",
      label: "Create buffer account",
      rentLamports: 0,
      transientLamports: bufferRent,
      feeLamports: BASE_TX_FEE_LAMPORTS,
      detail: `Allocate a ${BUFFER_METADATA + programLen}-byte buffer (held by the upgradeable loader) and fund it with ${bufferRent.toLocaleString()} lamports of rent. Refunded to you when the buffer is drained at deploy time.`,
    });

    steps.push({
      index: idx++,
      kind: "write",
      label: `Write program bytes (${writeTxCount} transaction${writeTxCount === 1 ? "" : "s"})`,
      rentLamports: 0,
      transientLamports: 0,
      feeLamports: writeTxCount * BASE_TX_FEE_LAMPORTS,
      detail: `Stream the ${programLen.toLocaleString()}-byte program into the buffer in ~${WRITE_CHUNK_BYTES}-byte chunks. ${writeTxCount} write transaction${writeTxCount === 1 ? "" : "s"} at ${BASE_TX_FEE_LAMPORTS} lamports each.`,
    });

    steps.push({
      index: idx++,
      kind: "deploy",
      label: "Deploy program from buffer",
      rentLamports: programAccountRent + programDataRent,
      transientLamports: -bufferRent,
      feeLamports: BASE_TX_FEE_LAMPORTS,
      detail: `Create the program account (${PROGRAM_ACCOUNT_SIZE} B, rent ${programAccountRent.toLocaleString()}) and the programdata account (${(PROGRAMDATA_METADATA + maxLenMultiplier * programLen).toLocaleString()} B at ${maxLenMultiplier}× upgrade headroom, rent ${programDataRent.toLocaleString()}). The buffer's lamports roll into the programdata account.`,
    });
  }

  for (const struct of initStructs) {
    const accts = initAccounts.filter((a) => a.struct === struct);
    const rent = accts.reduce((s, a) => s + (a.rentLamports ?? 0), 0);
    const names = accts.map((a) => a.name).join(", ");
    const anyUnresolved = accts.some((a) => a.rentLamports === null);
    steps.push({
      index: idx++,
      kind: "initialize",
      label: `Initialize: ${struct}`,
      rentLamports: rent,
      transientLamports: 0,
      feeLamports: BASE_TX_FEE_LAMPORTS,
      detail:
        `Invoke the handler using \`Context<${struct}>\` to create ${accts.length} account(s): ${names}. ` +
        `Payer funds ${rent.toLocaleString()} lamports of rent` +
        (anyUnresolved ? " (plus unresolved-space accounts — see notes)." : "."),
    });
  }

  const lockedLamports = programAccountRent + programDataRent + initRentLamports;
  // Safe upper bound: buffer coexists with the rent you must already hold, so we
  // add it rather than netting it out.
  const walletRequiredLamports = lockedLamports + bufferRent + txFeeLamports;

  return {
    binary,
    programLen,
    maxLenMultiplier,
    priorityMicroLamports,
    programAccountRent,
    programDataRent,
    bufferRent,
    writeTxCount,
    txFeeLamports,
    initAccounts,
    initRentLamports,
    unresolvedInit,
    steps,
    lockedLamports,
    walletRequiredLamports,
    generatedAt: new Date().toISOString(),
  };
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function sol(lamports: number): string {
  return `${lamportsToSol(lamports)} SOL`;
}

export function renderDeployPlanMd(p: DeployPlan): string {
  const L: string[] = ["## Deployment Plan\n"];

  if (p.programLen == null) {
    L.push(
      "⚠️  **No compiled `.so` found** under `target/deploy/`. Run `anchor build` (or `cargo build-sbf`) first for exact deploy cost. The transaction sequence below is structural; rent figures for the program binary are omitted.\n",
    );
  } else {
    const srcNote = p.binary
      ? `\`${p.binary.path.split("/").slice(-1)[0]}\` (${p.programLen.toLocaleString()} bytes)`
      : `${p.programLen.toLocaleString()} bytes (provided)`;
    L.push(`**Program binary:** ${srcNote}\n`);

    L.push("### How much SOL do I need?\n");
    L.push("| Item | Size | Rent (lamports) | SOL | Recoverable? |");
    L.push("|------|------|-----------------|-----|--------------|");
    L.push(
      `| Program account | ${PROGRAM_ACCOUNT_SIZE} B | ${p.programAccountRent.toLocaleString()} | ${lamportsToSol(p.programAccountRent)} | ❌ until program closed |`,
    );
    L.push(
      `| Program data (${p.maxLenMultiplier}× headroom) | ${(PROGRAMDATA_METADATA + p.maxLenMultiplier * p.programLen).toLocaleString()} B | ${p.programDataRent.toLocaleString()} | ${lamportsToSol(p.programDataRent)} | ❌ until program closed |`,
    );
    L.push(
      `| Buffer (transient) | ${(BUFFER_METADATA + p.programLen).toLocaleString()} B | ${p.bufferRent.toLocaleString()} | ${lamportsToSol(p.bufferRent)} | ✅ refunded at deploy |`,
    );
    if (p.initAccounts.length > 0) {
      L.push(
        `| Init accounts (${p.initAccounts.length}) | — | ${p.initRentLamports.toLocaleString()} | ${lamportsToSol(p.initRentLamports)} | depends on close logic |`,
      );
    }
    L.push(
      `| Transaction fees (~${p.steps.reduce((s, x) => s + (x.feeLamports > 0 ? 1 : 0), 0)} steps) | — | ${p.txFeeLamports.toLocaleString()} | ${lamportsToSol(p.txFeeLamports)} | ❌ spent |`,
    );
    L.push("");
    L.push(
      `**→ Fund the deploying wallet with at least ${sol(p.walletRequiredLamports)}** (${p.walletRequiredLamports.toLocaleString()} lamports).`,
    );
    L.push(
      `Steady-state locked after deploy: **${sol(p.lockedLamports)}** (program + programdata + init rent). The buffer rent and fees are not part of the steady-state lockup.\n`,
    );
    if (p.priorityMicroLamports > 0) {
      L.push(
        `_Priority fee of ${p.priorityMicroLamports} µlamports/CU requested — add it on top of the base fees above for congested-network safety._\n`,
      );
    }
  }

  L.push("### Exact transaction sequence\n");
  for (const s of p.steps) {
    const tags: string[] = [];
    if (s.rentLamports > 0) tags.push(`locks ${sol(s.rentLamports)}`);
    if (s.transientLamports > 0) tags.push(`transient ${sol(s.transientLamports)}`);
    if (s.transientLamports < 0) tags.push(`refunds ${sol(-s.transientLamports)}`);
    if (s.feeLamports > 0) tags.push(`fee ${sol(s.feeLamports)}`);
    const tagStr = tags.length ? `  _(${tags.join(", ")})_` : "";
    L.push(`${s.index}. **${s.label}**${tagStr}`);
    L.push(`   ${s.detail}`);
  }
  L.push("");

  if (p.initAccounts.length > 0) {
    L.push("### Init accounts (rent at setup)\n");
    L.push("| Account | Struct | Type | Space | Rent | PDA seeds | Payer |");
    L.push("|---------|--------|------|-------|------|-----------|-------|");
    for (const a of p.initAccounts) {
      const file = a.file.split("/").slice(-2).join("/");
      const space = a.space != null ? `${a.space} B` : `⚠️ \`${a.spaceExpr ?? "?"}\``;
      const rent = a.rentLamports != null ? lamportsToSol(a.rentLamports) + " SOL" : "—";
      const seeds = a.seeds ? `\`${a.seeds.replace(/\|/g, "\\|")}\`` : "(keypair)";
      L.push(
        `| \`${a.name}\`${a.conditional ? " (cond.)" : ""} (${file}:${a.line}) | ${a.struct} | \`${a.typeName.replace(/\|/g, "\\|")}\` | ${space} | ${rent} | ${seeds} | ${a.payer ?? "—"} |`,
      );
    }
    L.push("");
    if (p.unresolvedInit.length > 0) {
      L.push(
        `> ⚠️  ${p.unresolvedInit.length} account(s) declare \`space\` via a non-literal expression (e.g. \`8 + State::INIT_SPACE\`). Their rent is excluded from the totals above — resolve the constant to get an exact figure.\n`,
      );
    }
  }

  return L.join("\n");
}

export function renderDeployPlanText(p: DeployPlan): string {
  const L: string[] = [];
  L.push("── Deployment Plan ──────────────────────────────────────────");
  if (p.programLen == null) {
    L.push("  no compiled .so found — run `anchor build` for exact cost.");
    L.push("  (showing structural transaction sequence only)");
  } else {
    L.push(`  program binary: ${p.programLen.toLocaleString()} bytes`);
    L.push(`  program account:   ${p.programAccountRent.toLocaleString()} lamports (${lamportsToSol(p.programAccountRent)} SOL)`);
    L.push(`  program data (${p.maxLenMultiplier}x):  ${p.programDataRent.toLocaleString()} lamports (${lamportsToSol(p.programDataRent)} SOL)`);
    L.push(`  buffer (transient): ${p.bufferRent.toLocaleString()} lamports (${lamportsToSol(p.bufferRent)} SOL, refunded)`);
    if (p.initAccounts.length > 0)
      L.push(`  init accounts:     ${p.initRentLamports.toLocaleString()} lamports (${lamportsToSol(p.initRentLamports)} SOL)`);
    L.push(`  tx fees (est):     ${p.txFeeLamports.toLocaleString()} lamports (${lamportsToSol(p.txFeeLamports)} SOL)`);
    L.push(`  ─── fund wallet with ≥ ${lamportsToSol(p.walletRequiredLamports)} SOL  (steady-state locked: ${lamportsToSol(p.lockedLamports)} SOL)`);
  }
  L.push("  sequence:");
  for (const s of p.steps) {
    const locks = s.rentLamports > 0 ? ` +${lamportsToSol(s.rentLamports)} SOL` : "";
    L.push(`    ${s.index}. ${s.label}${locks}`);
  }
  if (p.unresolvedInit.length > 0)
    L.push(`  note: ${p.unresolvedInit.length} init account(s) have non-literal space — excluded from totals.`);
  return L.join("\n");
}
