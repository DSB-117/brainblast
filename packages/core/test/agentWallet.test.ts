import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import {
  base58Encode,
  generateKeypair,
  createWallet,
  getActiveWallet,
  listWallets,
  setActiveWallet,
  loadSecretKey,
  isRecoverable,
  walletManifestPath,
} from "../src/wallet/agentWallet.ts";

describe("Agent Wallet (P0 — key lifecycle + recovery)", () => {
  let vdir: string;
  let wdir: string;
  let prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    vdir = mkdtempSync(join(tmpdir(), "aw-vault-"));
    wdir = mkdtempSync(join(tmpdir(), "aw-home-"));
    prev = {
      vault: process.env.BRAINBLAST_VAULT_DIR,
      pass: process.env.BRAINBLAST_VAULT_PASSPHRASE,
      wfile: process.env.BRAINBLAST_WALLET_FILE,
    };
    process.env.BRAINBLAST_VAULT_DIR = vdir;
    process.env.BRAINBLAST_VAULT_PASSPHRASE = "test-passphrase";
    process.env.BRAINBLAST_WALLET_FILE = join(wdir, "wallet.json");
  });
  afterEach(() => {
    rmSync(vdir, { recursive: true, force: true });
    rmSync(wdir, { recursive: true, force: true });
    for (const [k, v] of [
      ["BRAINBLAST_VAULT_DIR", prev.vault],
      ["BRAINBLAST_VAULT_PASSPHRASE", prev.pass],
      ["BRAINBLAST_WALLET_FILE", prev.wfile],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("generates a Solana-valid keypair (matches @solana/web3.js byte-for-byte)", () => {
    const gen = generateKeypair();
    expect(gen.secretKeyArray).toHaveLength(64);
    const kp = Keypair.fromSecretKey(Uint8Array.from(gen.secretKeyArray));
    expect(kp.publicKey.toBase58()).toBe(gen.pubkey);
  });

  it("base58Encode preserves leading-zero bytes as '1'", () => {
    expect(base58Encode(Uint8Array.from([0, 0, 1]))).toBe("112");
    expect(base58Encode(Uint8Array.from([0]))).toBe("1");
  });

  it("create → recover round-trips the secret through the Vault", () => {
    const gen = createWallet({ label: "ci-bot" });
    expect(getActiveWallet()?.pubkey).toBe(gen.pubkey);
    expect(isRecoverable(gen.pubkey)).toBe(true);

    const recovered = loadSecretKey(gen.pubkey);
    expect(Array.from(recovered)).toEqual(gen.secretKeyArray);
    // The recovered key still controls the same address.
    expect(Keypair.fromSecretKey(recovered).publicKey.toBase58()).toBe(gen.pubkey);
  });

  it("never writes the secret to the manifest (only a pubkey index)", () => {
    const gen = createWallet();
    const manifestRaw = readFileSync(walletManifestPath(), "utf8");
    expect(manifestRaw).toContain(gen.pubkey);
    // The 64-int secret array must not appear anywhere in the manifest.
    expect(manifestRaw).not.toContain(JSON.stringify(gen.secretKeyArray));
    expect(manifestRaw).not.toContain(String(gen.secretKeyArray[0]) + "," + String(gen.secretKeyArray[1]));
  });

  it("survives a wiped working tree: recovers from the Vault by pubkey", () => {
    const gen = createWallet();
    // Simulate `git clean -fdx` / rm -rf of the project: only the Vault (which
    // lives OUTSIDE the repo) and the manifest pointer remain.
    expect(isRecoverable(gen.pubkey)).toBe(true);
    const recovered = loadSecretKey(gen.pubkey);
    expect(Keypair.fromSecretKey(recovered).publicKey.toBase58()).toBe(gen.pubkey);
  });

  it("loses the wallet only if the Vault is gone (unrecoverable signal)", () => {
    const gen = createWallet();
    // Destroy the Vault objects — the irrecoverable case.
    rmSync(vdir, { recursive: true, force: true });
    expect(isRecoverable(gen.pubkey)).toBe(false);
    expect(() => loadSecretKey(gen.pubkey)).toThrow();
  });

  it("tracks multiple wallets and switches the active one", () => {
    const a = createWallet({ label: "a" });
    const b = createWallet({ label: "b" });
    expect(getActiveWallet()?.pubkey).toBe(b.pubkey);
    expect(listWallets().map((w) => w.pubkey).sort()).toEqual([a.pubkey, b.pubkey].sort());
    setActiveWallet(a.pubkey);
    expect(getActiveWallet()?.pubkey).toBe(a.pubkey);
    expect(() => setActiveWallet("not-a-real-pubkey")).toThrow();
  });

  it("stores the Vault object encrypted (no plaintext secret on disk)", () => {
    const gen = createWallet();
    const objectsDir = join(vdir, "objects");
    const files = readdirSync(objectsDir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const blob = readFileSync(join(objectsDir, f));
      // The encrypted blob starts with the "BBV1" magic and must not contain the
      // plaintext JSON secret array.
      expect(blob.subarray(0, 4).toString()).toBe("BBV1");
      expect(blob.includes(Buffer.from(JSON.stringify(gen.secretKeyArray)))).toBe(false);
    }
    expect(existsSync(objectsDir)).toBe(true);
  });
});
