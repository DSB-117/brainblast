import { base58Encode, isValidSolanaAddress } from "./base58.ts";
import type { UpgradeAuthority } from "./types.ts";

// Live JSON-RPC probe for a program's upgrade authority. This is the only
// thing in the trust-graph pipeline that touches the network. It is small,
// timeout-bounded, and uses a public RPC by default — the caller can inject
// any endpoint (Helius, Triton, a local validator) without code changes.

export const BPF_UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const BPF_LOADER_2 = "BPFLoader2111111111111111111111111111111111";
export const NATIVE_LOADER = "NativeLoader1111111111111111111111111111111";

// Default public RPC. Rate-limited; for production runs, callers should pass
// their own endpoint via opts.rpcUrl.
export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export interface RpcOpts {
  rpcUrl?: string;
  timeoutMs?: number;
  // Injection point for tests. Defaults to global fetch.
  fetchImpl?: typeof fetch;
}

interface AccountInfo {
  owner: string; // base58 program id of the owner
  data: Uint8Array;
  executable: boolean;
  lamports: number;
}

async function rpc<T>(method: string, params: any[], opts: RpcOpts): Promise<T> {
  const url = opts.rpcUrl ?? DEFAULT_RPC;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`rpc ${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
    if (body.result === undefined) throw new Error(`rpc ${method}: empty result`);
    return body.result;
  } finally {
    clearTimeout(t);
  }
}

export async function getAccountInfo(address: string, opts: RpcOpts = {}): Promise<AccountInfo | null> {
  if (!isValidSolanaAddress(address)) throw new Error(`invalid Solana address: ${address}`);
  const result = await rpc<{ value: any | null }>(
    "getAccountInfo",
    [address, { encoding: "base64", commitment: "confirmed" }],
    opts,
  );
  if (!result || !result.value) return null;
  const v = result.value as { owner: string; data: [string, string]; executable: boolean; lamports: number };
  const [b64] = v.data;
  return {
    owner: v.owner,
    data: Buffer.from(b64, "base64"),
    executable: v.executable,
    lamports: v.lamports,
  };
}

// Resolves a program's upgrade authority by reading the BPF Upgradeable
// Loader's account layout directly.
//
// Program account data (4-byte little-endian enum + payload):
//   tag = 2 (Program) → 32-byte programdata_address
//
// ProgramData account data:
//   tag = 3 (ProgramData), 8 bytes slot, 1-byte Option tag, 32-byte authority
//
// References:
//   https://docs.rs/solana-program/latest/solana_program/bpf_loader_upgradeable/enum.UpgradeableLoaderState.html
export async function probeUpgradeAuthority(programId: string, opts: RpcOpts = {}): Promise<UpgradeAuthority> {
  const acct = await getAccountInfo(programId, opts);
  if (!acct) {
    return {
      kind: "unknown",
      address: null,
      source: "rpc",
      checkedAt: new Date().toISOString(),
    };
  }

  // Non-upgradeable cases: any other loader = frozen / renounced equivalent.
  if (acct.owner === BPF_LOADER_2 || acct.owner === NATIVE_LOADER) {
    return {
      kind: "renounced",
      address: null,
      source: "rpc",
      checkedAt: new Date().toISOString(),
    };
  }

  if (acct.owner !== BPF_UPGRADEABLE_LOADER) {
    // The account isn't a program (or is owned by a non-loader). The caller
    // gave us something that isn't a deployed program — bubble that up so the
    // builder can mark it unresolved.
    throw new Error(
      `program ${programId} is owned by ${acct.owner}, not a known loader; not a deployed program?`,
    );
  }

  // Read program account: tag(4) + programdata_pubkey(32).
  if (acct.data.length < 36) throw new Error(`program account too small: ${acct.data.length}`);
  const tag = acct.data[0] | (acct.data[1] << 8) | (acct.data[2] << 16) | (acct.data[3] << 24);
  if (tag !== 2) throw new Error(`expected Program (tag=2) state, got tag=${tag}`);
  const programDataAddr = base58Encode(acct.data.subarray(4, 36));

  const pd = await getAccountInfo(programDataAddr, opts);
  if (!pd) {
    throw new Error(`program ${programId} ProgramData ${programDataAddr} not found`);
  }
  // ProgramData layout: tag(4) + slot(8) + Option<Pubkey>(1+32).
  if (pd.data.length < 45) throw new Error(`ProgramData account too small: ${pd.data.length}`);
  const pdTag = pd.data[0] | (pd.data[1] << 8) | (pd.data[2] << 16) | (pd.data[3] << 24);
  if (pdTag !== 3) throw new Error(`expected ProgramData (tag=3), got tag=${pdTag}`);
  const optionTag = pd.data[12];
  const checkedAt = new Date().toISOString();
  if (optionTag === 0) {
    return { kind: "renounced", address: null, source: "rpc", checkedAt };
  }
  if (optionTag !== 1) throw new Error(`unexpected Option tag in ProgramData: ${optionTag}`);
  const authority = base58Encode(pd.data.subarray(13, 45));
  // We can't tell single-key vs multisig vs DAO from the address alone — that
  // requires classifying the authority account's owner program. Mark as
  // "unknown" and let directory entries or research enrich it.
  return { kind: "unknown", address: authority, source: "rpc", checkedAt };
}
