// Wallet Guard — scan the frontend for how the wallet adapter is actually wired.
//
// We answer: which network does the ConnectionProvider endpoint resolve to, is
// it tied to an env var, does it use the rate-limited public RPC, and is the
// wallet-adapter UI styled? Conservative content matching — no AST needed for
// these distinctive, import-anchored patterns.

import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { walkAllFiles } from "../walk.ts";
import type { SolanaNetwork } from "./envConfig.ts";

export interface CodeSite {
  file: string; // repo-relative
  line: number;
}

export interface CodeConfig {
  walletAdapterFiles: string[];
  hardcodedNetwork: (CodeSite & { network: SolanaNetwork }) | null;
  referencesEnvVar: boolean;
  usesPublicMainnetRpc: CodeSite | null;
  usesModalUI: CodeSite | null;
  importsStyles: boolean;
}

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;
const MAX_BYTES = 256 * 1024;

function findLine(content: string, re: RegExp): number | null {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return null;
}

function networkFromClusterCall(content: string): SolanaNetwork | null {
  const m = content.match(/clusterApiUrl\s*\(\s*(?:WalletAdapterNetwork\.(\w+)|['"]([\w-]+)['"])/);
  if (m) {
    const tok = (m[1] ?? m[2] ?? "").toLowerCase();
    if (tok.includes("mainnet")) return "mainnet";
    if (tok.includes("devnet")) return "devnet";
    if (tok.includes("testnet")) return "testnet";
  }
  if (/api\.mainnet-beta\.solana\.com/.test(content)) return "mainnet";
  if (/api\.devnet\.solana\.com/.test(content)) return "devnet";
  if (/api\.testnet\.solana\.com/.test(content)) return "testnet";
  // A bare `WalletAdapterNetwork.Mainnet` used as the network value.
  if (/WalletAdapterNetwork\.Mainnet\b/.test(content)) return "mainnet";
  if (/WalletAdapterNetwork\.Devnet\b/.test(content)) return "devnet";
  if (/WalletAdapterNetwork\.Testnet\b/.test(content)) return "testnet";
  return null;
}

export function scanCode(dir: string, envVarNames: string[]): CodeConfig {
  const cfg: CodeConfig = {
    walletAdapterFiles: [],
    hardcodedNetwork: null,
    referencesEnvVar: false,
    usesPublicMainnetRpc: null,
    usesModalUI: null,
    importsStyles: false,
  };
  const envRe = envVarNames.length
    ? new RegExp(`(?:process\\.env|import\\.meta\\.env)\\.(?:${envVarNames.map((n) => n.replace(/[^A-Za-z0-9_]/g, "")).join("|")})\\b`)
    : null;

  for (const path of walkAllFiles(dir)) {
    if (!CODE_EXT.test(path)) continue;
    let content: string;
    try {
      if (statSync(path).size > MAX_BYTES) continue;
      content = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (!content.includes("@solana/wallet-adapter-react")) continue;

    const rel = relative(dir, path);
    cfg.walletAdapterFiles.push(rel);

    if (!cfg.hardcodedNetwork) {
      const net = networkFromClusterCall(content);
      if (net) {
        // Prefer the call site / literal over a bare `import { clusterApiUrl }`.
        const line = findLine(content, /clusterApiUrl\s*\(|mainnet-beta|api\.(devnet|testnet)\.solana|WalletAdapterNetwork\.(Mainnet|Devnet|Testnet)/) ?? 1;
        cfg.hardcodedNetwork = { file: rel, line, network: net };
      }
    }
    if (envRe && envRe.test(content)) cfg.referencesEnvVar = true;

    if (!cfg.usesPublicMainnetRpc) {
      const pub =
        /clusterApiUrl\s*\(\s*(?:WalletAdapterNetwork\.Mainnet|['"]mainnet-beta['"])/.test(content) ||
        /https?:\/\/api\.mainnet-beta\.solana\.com/.test(content);
      if (pub) cfg.usesPublicMainnetRpc = { file: rel, line: findLine(content, /mainnet-beta|WalletAdapterNetwork\.Mainnet/) ?? 1 };
    }

    if (!cfg.usesModalUI) {
      const line = findLine(content, /WalletModalProvider|WalletMultiButton|WalletConnectButton/);
      if (line) cfg.usesModalUI = { file: rel, line };
    }
    if (content.includes("@solana/wallet-adapter-react-ui/styles.css")) cfg.importsStyles = true;
  }

  return cfg;
}
