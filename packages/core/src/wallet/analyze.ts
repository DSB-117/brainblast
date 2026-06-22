// Wallet Guard — reconcile declared config (.env) against actual wiring (code).
//
// The whole point: a frontend can *say* devnet and *behave* mainnet. We compare
// what the env declares with how the wallet adapter is actually wired and emit
// the gaps — wrong cluster, dead env var, rate-limited public RPC, leaked key,
// unstyled wallet modal.

import { readEnvConfig } from "./envConfig.ts";
import { scanCode } from "./codeConfig.ts";

export type WalletSeverity = "critical" | "high" | "medium";
export type WalletVerdict = "allow" | "warn" | "block";

export interface WalletFinding {
  id: string;
  severity: WalletSeverity;
  title: string;
  detail: string;
  file?: string;
  line?: number;
}

export interface WalletReport {
  dir: string;
  walletAdapterDetected: boolean;
  findings: WalletFinding[];
  verdict: WalletVerdict;
}

export function analyzeWallet(dir: string): WalletReport {
  const env = readEnvConfig(dir);
  const code = scanCode(dir, env.networkVars.map((v) => v.key));
  const findings: WalletFinding[] = [];
  const hasWallet = code.walletAdapterFiles.length > 0;

  // C — exposed RPC key (independent of wallet-adapter code).
  for (const k of env.exposedKeys) {
    findings.push({
      id: "solana-rpc-key-exposed",
      severity: "high",
      title: "RPC API key exposed to the browser",
      detail: `${k.key} holds a ${k.provider} RPC URL with an embedded API key. Client-exposed env vars (NEXT_PUBLIC_/VITE_/REACT_APP_) ship to every visitor — anyone can drain your paid RPC quota. Proxy the RPC through a backend route instead.`,
      file: k.file,
      line: k.line,
    });
  }

  if (hasWallet) {
    const declared = env.declaredNetwork;
    const hardcoded = code.hardcodedNetwork;
    const mismatch = !!declared && !!hardcoded && declared !== hardcoded.network && !code.referencesEnvVar;

    // A — network mismatch (the headline).
    if (mismatch && hardcoded) {
      findings.push({
        id: "solana-wallet-network-mismatch",
        severity: "critical",
        title: "Wallet network does not match the configured network",
        detail: `.env declares the network as '${declared}', but the wallet adapter's endpoint is hardcoded to '${hardcoded.network}' and isn't wired to the env var. The app will run on '${hardcoded.network}' regardless — referencing real funds when you intended '${declared}'. Derive the ConnectionProvider endpoint from the network env var.`,
        file: hardcoded.file,
        line: hardcoded.line,
      });
    }

    // A′ — declared but unwired (the dead env var).
    if (declared && !code.referencesEnvVar && !mismatch) {
      const nv = env.networkVars.find((v) => v.network);
      findings.push({
        id: "solana-network-env-unwired",
        severity: "high",
        title: "Network env var is declared but never read",
        detail: `${nv?.key ?? "the network env var"} is set to '${declared}', but no source file reads it — the value is dead and the wallet adapter ships whatever the source hardcodes. Wire the ConnectionProvider's network/endpoint to ${nv?.key ?? "the env var"}.`,
        file: nv?.file,
        line: nv?.line,
      });
    }

    // B — public mainnet RPC in a mainnet-bound app.
    if (code.usesPublicMainnetRpc) {
      findings.push({
        id: "solana-public-rpc-endpoint",
        severity: "high",
        title: "Uses the rate-limited public mainnet RPC",
        detail: `The endpoint resolves to the public mainnet RPC (api.mainnet-beta.solana.com). It is heavily rate-limited and not for production — you'll hit 429s under real load. Use a dedicated RPC provider (Helius, QuickNode, Triton, …).`,
        file: code.usesPublicMainnetRpc.file,
        line: code.usesPublicMainnetRpc.line,
      });
    }

    // D — wallet-adapter UI used without its stylesheet.
    if (code.usesModalUI && !code.importsStyles) {
      findings.push({
        id: "solana-wallet-ui-styles-missing",
        severity: "medium",
        title: "Wallet-adapter UI styles not imported",
        detail: `This uses @solana/wallet-adapter-react-ui components (WalletModalProvider / WalletMultiButton) but never imports '@solana/wallet-adapter-react-ui/styles.css'. The connect modal renders unstyled and may look broken. Import the stylesheet once at the app root.`,
        file: code.usesModalUI.file,
        line: code.usesModalUI.line,
      });
    }
  }

  return { dir, walletAdapterDetected: hasWallet, findings, verdict: verdictOf(findings) };
}

// Inline export name for agent frameworks (mirrors firewall.inspectTransaction).
export const inspectWalletConfig = analyzeWallet;

function verdictOf(findings: WalletFinding[]): WalletVerdict {
  if (findings.some((f) => f.severity === "critical")) return "block";
  if (findings.length > 0) return "warn";
  return "allow";
}

// ── Rendering ────────────────────────────────────────────────────────────────
const SEV_ICON: Record<WalletSeverity, string> = { critical: "⛔", high: "🔴", medium: "🟡" };
const BANNER: Record<WalletVerdict, string> = {
  allow: "OK — wallet config looks consistent",
  warn: "WARN — wallet config issues found",
  block: "BLOCK — wallet network/config mismatch",
};

export function renderWalletText(r: WalletReport): string {
  const lines: string[] = [];
  lines.push(`Wallet Guard  [${BANNER[r.verdict]}]  ${r.dir}`);
  if (!r.walletAdapterDetected && r.findings.length === 0) {
    lines.push("");
    lines.push("  No @solana/wallet-adapter-react setup detected.");
    return lines.join("\n");
  }
  lines.push("");
  if (r.findings.length === 0) {
    lines.push("  No issues — declared network is wired through and the adapter is configured correctly.");
    return lines.join("\n");
  }
  for (const f of r.findings) {
    lines.push(`  ${SEV_ICON[f.severity]} [${f.id}] ${f.title}${f.file ? `  (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`);
    lines.push(`      ${f.detail}`);
  }
  return lines.join("\n");
}
