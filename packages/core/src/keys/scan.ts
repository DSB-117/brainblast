// Keyguard — filesystem scan, git/recovery context, and report assembly.
//
// detect.ts says "this string is a secret"; this module finds the files, decides
// the blast tier, and — critically — works out whether git can save you if the
// file is deleted. (For gitignored secrets, it can't: that's the whole point.)

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { detectFileSecrets } from "./detect.ts";
import type {
  BlastTier,
  DetectedSecret,
  KeysReport,
  KeysSummary,
  RawDetection,
} from "./types.ts";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".agent-research",
  ".gen",
  "coverage",
  ".brainblast",
]);

// Secrets are always tiny; skipping large/binary files keeps the scan fast and
// avoids slurping Rust build artifacts or media.
const MAX_BYTES = 64 * 1024;

const FIXTURE_RE = /(^|[\/\\])(fixtures?|__tests__|test|tests|mocks?|examples?|samples?)([\/\\]|$)/i;

// Walk for secret material: keep `target/deploy` (where program keypairs live)
// but skip the rest of a Rust `target/` build tree.
function gatherFiles(dir: string, root: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      // Inside a Rust `target/` tree, only descend into `deploy` (program
      // keypairs live there); skip the rest of the build output.
      const segs = relative(root, p).split(sep);
      if (segs[0] === "target" && segs.length >= 2 && segs[1] !== "deploy") continue;
      gatherFiles(p, root, out);
    } else if (st.isFile() && st.size <= MAX_BYTES) {
      out.push(p);
    }
  }
}

function isProbablyText(buf: Buffer): boolean {
  const n = Math.min(buf.length, 1024);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

function deriveTier(d: RawDetection, rel: string): { tier: BlastTier; needsOnchainCheck: boolean } {
  const isKeyMaterial =
    d.kind === "solana-keypair-64" ||
    d.kind === "solana-secret-32" ||
    d.kind === "base58-secret-key" ||
    d.kind === "bip39-mnemonic";

  if (isKeyMaterial) {
    if (FIXTURE_RE.test(rel)) return { tier: "trivial", needsOnchainCheck: false };
    // Fail-safe: an unscoped private key is assumed to bear funds / authority
    // until the chain proves otherwise. The on-chain step can promote to
    // `terminal` (live upgrade authority) or demote to `rebuildable`/`trivial`.
    return { tier: "funds", needsOnchainCheck: true };
  }
  // Named-but-unshaped or path references: real but lower-confidence.
  return { tier: "unknown", needsOnchainCheck: d.kind === "keypair-path-ref" ? false : true };
}

interface GitContext {
  tracked: Set<string>; // repo-relative paths git is tracking
  ignored: (paths: string[]) => Set<string>;
  isRepo: boolean;
}

function gitContext(root: string): GitContext {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { stdio: "pipe" });
  } catch {
    return { tracked: new Set(), ignored: () => new Set(), isRepo: false };
  }
  let tracked = new Set<string>();
  try {
    const out = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    tracked = new Set(out.split(/\r?\n/).filter(Boolean));
  } catch {
    /* ignore */
  }
  const ignored = (paths: string[]): Set<string> => {
    if (paths.length === 0) return new Set();
    try {
      const out = execFileSync("git", ["-C", root, "check-ignore", "--stdin"], {
        input: paths.join("\n"),
        encoding: "utf8",
      });
      return new Set(out.split(/\r?\n/).filter(Boolean));
    } catch (e: any) {
      // `check-ignore` exits 1 when nothing matched — that's "none ignored", not
      // an error. Any stdout it produced still lists the matches.
      const stdout = e?.stdout ? String(e.stdout) : "";
      return new Set(stdout.split(/\r?\n/).filter(Boolean));
    }
  };
  return { tracked, ignored, isRepo: true };
}

export interface ScanOpts {
  // Extra absolute paths to inspect beyond the project tree — e.g. the default
  // wallet at ~/.config/solana/id.json. These get no git context.
  extraPaths?: string[];
  // Returns true if the file at this absolute path is backed up in the Vault.
  // Injected so scan.ts stays decoupled from the Vault module (and testable).
  vaultLookup?: (absPath: string) => boolean;
}

export function scanSecrets(root: string, opts: ScanOpts = {}): KeysReport {
  const absRoot = resolve(root);
  const files: string[] = [];
  gatherFiles(absRoot, absRoot, files);

  const externalFiles = (opts.extraPaths ?? [])
    .map((p) => (isAbsolute(p) ? p : resolve(p)))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
  const allFiles = [...files, ...externalFiles.filter((p) => !files.includes(p))];
  const externalSet = new Set(externalFiles);

  const git = gitContext(absRoot);

  const secrets: DetectedSecret[] = [];
  const inRepoRel: string[] = [];
  const pending: { d: RawDetection; path: string; rel: string; external: boolean }[] = [];

  for (const path of allFiles) {
    let buf: Buffer;
    try {
      buf = readFileSync(path);
    } catch {
      continue;
    }
    if (!isProbablyText(buf)) continue;
    const content = buf.toString("utf8");
    const detections = detectFileSecrets(content);
    if (detections.length === 0) continue;

    const external = externalSet.has(path);
    const rel = external ? path : relative(absRoot, path);
    for (const d of detections) {
      pending.push({ d, path, rel, external });
      if (!external) inRepoRel.push(rel);
    }
  }

  const ignoredSet = git.isRepo ? git.ignored([...new Set(inRepoRel)]) : new Set<string>();

  for (const { d, path, rel, external } of pending) {
    const { tier, needsOnchainCheck } = deriveTier(d, rel);
    const gitTracked = external || !git.isRepo ? undefined : git.tracked.has(rel);
    const gitIgnored = external || !git.isRepo ? undefined : ignoredSet.has(rel);
    secrets.push({
      ...d,
      path,
      rel,
      tier,
      needsOnchainCheck,
      gitTracked,
      gitIgnored,
      vaulted: opts.vaultLookup ? opts.vaultLookup(path) : false,
      external,
      inGitRepo: git.isRepo,
    });
  }

  return finalizeReport(absRoot, secrets);
}

// Sort, summarize, and assign a verdict. Shared by the offline scan and the
// on-chain enrichment so both produce an identically-shaped report.
export function finalizeReport(root: string, secrets: DetectedSecret[]): KeysReport {
  secrets.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.rel.localeCompare(b.rel));
  return { root, secrets, summary: summarize(secrets), verdict: verdictOf(secrets) };
}

const TIER_ORDER: Record<BlastTier, number> = {
  terminal: 0,
  funds: 1,
  unknown: 2,
  rebuildable: 3,
  trivial: 4,
};

function isHighTier(t: BlastTier): boolean {
  return t === "terminal" || t === "funds";
}

function summarize(secrets: DetectedSecret[]): KeysSummary {
  const s: KeysSummary = {
    terminal: 0,
    funds: 0,
    rebuildable: 0,
    trivial: 0,
    unknown: 0,
    tracked: 0,
    recoverable: 0,
    unrecoverable: 0,
  };
  for (const sec of secrets) {
    s[sec.tier]++;
    if (sec.gitTracked) s.tracked++;
    // Recoverable if git tracks it OR the Vault holds it; unrecoverable if it's
    // gitignored and unvaulted AND losing it actually costs you something.
    const recoverable = sec.gitTracked === true || sec.vaulted === true;
    if (recoverable) s.recoverable++;
    else if (isHighTier(sec.tier)) s.unrecoverable++;
  }
  return s;
}

function verdictOf(secrets: DetectedSecret[]): KeysReport["verdict"] {
  let warn = false;
  for (const sec of secrets) {
    if (isHighTier(sec.tier)) {
      // Committed to git = a leak. Not backed up (gitignored, untracked, or an
      // external file) = one `rm` from permanent loss. Either is the headline
      // failure. The Vault demotes this by setting `vaulted` once it backs up.
      if (sec.gitTracked) return "exposed";
      if (!sec.vaulted) return "exposed";
    }
    if (sec.tier !== "trivial") warn = true;
  }
  return warn ? "warn" : "ok";
}

// ── Rendering ────────────────────────────────────────────────────────────────
const TIER_ICON: Record<BlastTier, string> = {
  terminal: "☠",
  funds: "🔴",
  unknown: "🟠",
  rebuildable: "🟡",
  trivial: "⚪",
};

const TIER_LABEL: Record<BlastTier, string> = {
  terminal: "TERMINAL",
  funds: "FUNDS",
  unknown: "UNSCOPED",
  rebuildable: "REBUILDABLE",
  trivial: "TRIVIAL",
};

export function renderKeysText(r: KeysReport): string {
  const lines: string[] = [];
  const verdictTag = r.verdict === "exposed" ? "EXPOSED" : r.verdict === "warn" ? "AT RISK" : "OK";
  lines.push(`Keyguard scan  [${verdictTag}]  ${r.root}`);
  lines.push(
    `  ${r.secrets.length} secret(s)  ·  ${r.summary.unrecoverable} unrecoverable (git can't restore)  ·  ${r.summary.tracked} committed to git`,
  );
  lines.push("");

  if (r.secrets.length === 0) {
    lines.push("  No irreplaceable secrets detected.");
    return lines.join("\n");
  }

  for (const s of r.secrets) {
    lines.push(`  ${TIER_ICON[s.tier]} ${TIER_LABEL[s.tier]}  ${s.rel}${s.line ? `:${s.line}` : ""}`);
    lines.push(`      ${s.reason}`);
    if (s.pubkey) lines.push(`      pubkey: ${s.pubkey}`);
    const recovery =
      s.gitTracked === true
        ? "⚠ committed to git (leak risk)"
        : s.gitIgnored === true
          ? "gitignored — git CANNOT restore this if deleted"
          : s.gitTracked === false
            ? "untracked — git cannot restore this if deleted"
            : s.external
              ? "outside the project — no git protection"
              : "no git repo here — git cannot restore this if deleted";
    const vault = s.vaulted ? "  ·  ✓ safe in the Vault" : "";
    const onchain = s.needsOnchainCheck ? "  ·  on-chain blast radius not yet resolved" : "";
    lines.push(`      ${recovery}${vault}${onchain}`);
  }
  return lines.join("\n");
}
