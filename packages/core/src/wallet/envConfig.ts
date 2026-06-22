// Wallet Guard — parse the project's .env* for Solana network + RPC config.
//
// We extract the *declared* network (so we can reconcile it against the code's
// actual wiring) and flag RPC URLs that embed an API key under a client-exposed
// variable prefix.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type SolanaNetwork = "mainnet" | "devnet" | "testnet" | "localnet";

export interface EnvNetworkVar {
  key: string;
  network: SolanaNetwork | null; // normalized, if the value names a network
  value: string;
  file: string;
  line: number;
  clientExposed: boolean; // NEXT_PUBLIC_ / VITE_ / REACT_APP_ → shipped to the browser
}

export interface ExposedRpcKey {
  key: string;
  file: string;
  line: number;
  provider: string;
}

export interface EnvConfig {
  networkVars: EnvNetworkVar[];
  exposedKeys: ExposedRpcKey[];
  declaredNetwork: SolanaNetwork | null; // the network the project says it targets
}

const ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production"];
const CLIENT_PREFIX = /^(NEXT_PUBLIC_|VITE_|REACT_APP_)/;
const NETWORK_KEY = /(SOLANA_)?(NETWORK|CLUSTER)$/i;
const RPC_KEY = /RPC/i;

export function normalizeNetwork(v: string): SolanaNetwork | null {
  const s = v.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (s === "mainnet" || s === "mainnet-beta" || s.includes("mainnet")) return "mainnet";
  if (s === "devnet" || s.includes("devnet")) return "devnet";
  if (s === "testnet" || s.includes("testnet")) return "testnet";
  if (s === "localnet" || s === "localhost" || s.includes("127.0.0.1") || s.includes("localhost")) return "localnet";
  return null;
}

// Provider RPC URLs that carry an embedded credential.
const KEY_URL_PATTERNS: { provider: string; re: RegExp }[] = [
  { provider: "Helius", re: /helius[^\s"']*[?&]api-key=[A-Za-z0-9-]+/i },
  { provider: "QuickNode", re: /[a-z0-9-]+\.(solana-\w+|quiknode\.pro)\/[A-Za-z0-9]{16,}/i },
  { provider: "Alchemy", re: /alchemy\.com\/v2\/[A-Za-z0-9_-]{16,}/i },
  { provider: "Ankr", re: /rpc\.ankr\.com\/solana[^\s"']*\/[A-Za-z0-9]{16,}/i },
  { provider: "Triton/Syndica", re: /(triton|syndica)[^\s"']*\/[A-Za-z0-9_-]{16,}/i },
  { provider: "generic", re: /https?:\/\/[^\s"']*[?&](api[-_]?key|token)=[A-Za-z0-9_-]{12,}/i },
];

function detectExposedKey(value: string): string | null {
  for (const { provider, re } of KEY_URL_PATTERNS) if (re.test(value)) return provider;
  return null;
}

function parseEnvFile(content: string, file: string): { networkVars: EnvNetworkVar[]; exposedKeys: ExposedRpcKey[] } {
  const networkVars: EnvNetworkVar[] = [];
  const exposedKeys: ExposedRpcKey[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (!value) continue;
    const clientExposed = CLIENT_PREFIX.test(key);

    if (NETWORK_KEY.test(key) || (RPC_KEY.test(key) && normalizeNetwork(value))) {
      networkVars.push({ key, network: normalizeNetwork(value), value, file, line: i + 1, clientExposed });
    }
    if (clientExposed) {
      const provider = detectExposedKey(value);
      if (provider) exposedKeys.push({ key, file, line: i + 1, provider });
    }
  }
  return { networkVars, exposedKeys };
}

export function readEnvConfig(dir: string): EnvConfig {
  const networkVars: EnvNetworkVar[] = [];
  const exposedKeys: ExposedRpcKey[] = [];
  for (const f of ENV_FILES) {
    let content: string;
    try {
      content = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    const r = parseEnvFile(content, f);
    networkVars.push(...r.networkVars);
    exposedKeys.push(...r.exposedKeys);
  }
  // The declared network = the first network var that names one (NETWORK/CLUSTER first).
  const declaredNetwork = networkVars.find((v) => v.network)?.network ?? null;
  return { networkVars, exposedKeys, declaredNetwork };
}

// Exposed for unit testing on raw content.
export const _parseEnvFile = parseEnvFile;
