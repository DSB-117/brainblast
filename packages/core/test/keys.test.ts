import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFileSecrets, classifySecretValue } from "../src/keys/detect.ts";
import { scanSecrets } from "../src/keys/scan.ts";
import { base58Encode } from "../src/trustGraph/base58.ts";

// A deterministic 64-byte keypair array (bytes 0..63). The last 32 bytes are the
// "public key", which the detector should surface without any crypto library.
const KEYPAIR_64 = Array.from({ length: 64 }, (_, i) => i);
const EXPECTED_PUBKEY = base58Encode(Uint8Array.from(KEYPAIR_64.slice(32)));
// A valid base58 secret = base58 of 64 bytes.
const BASE58_SECRET = base58Encode(Uint8Array.from(Array.from({ length: 64 }, (_, i) => (i * 7) % 256)));
const MNEMONIC_12 = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima";

describe("detect: Solana keypair files", () => {
  it("identifies a 64-int array as a keypair and derives the pubkey offline", () => {
    const d = detectFileSecrets(JSON.stringify(KEYPAIR_64));
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("solana-keypair-64");
    expect(d[0].confidence).toBe("high");
    expect(d[0].pubkey).toBe(EXPECTED_PUBKEY);
  });

  it("identifies a 32-int array as a bare secret (no pubkey offline)", () => {
    const d = detectFileSecrets(JSON.stringify(Array.from({ length: 32 }, () => 1)));
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("solana-secret-32");
    expect(d[0].pubkey).toBeUndefined();
  });

  it("does NOT flag arbitrary short int arrays or out-of-range bytes", () => {
    expect(detectFileSecrets("[1,2,3,4,5]")).toHaveLength(0);
    expect(detectFileSecrets(JSON.stringify(Array.from({ length: 64 }, () => 999)))).toHaveLength(0);
    expect(detectFileSecrets('{"foo":"bar"}')).toHaveLength(0);
  });
});

describe("detect: seed phrases", () => {
  it("flags a whole-file 12-word mnemonic", () => {
    const d = detectFileSecrets(MNEMONIC_12);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("bip39-mnemonic");
  });

  it("does not flag ordinary prose", () => {
    expect(detectFileSecrets("the quick brown fox jumped over a lazy dog today")).toHaveLength(0);
  });
});

describe("detect: env / config secrets", () => {
  it("flags an inline base58 secret key", () => {
    const d = detectFileSecrets(`SOLANA_PRIVATE_KEY=${BASE58_SECRET}\nPORT=3000`);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("base58-secret-key");
    expect(d[0].match).toBe("SOLANA_PRIVATE_KEY");
    expect(d[0].line).toBe(1);
  });

  it("flags an inline keypair array in .env", () => {
    const d = detectFileSecrets(`KEYPAIR=${JSON.stringify(KEYPAIR_64)}`);
    expect(d[0].kind).toBe("solana-keypair-64");
  });

  it("flags a keypair file path reference", () => {
    const d = detectFileSecrets("ANCHOR_WALLET=/home/me/.config/solana/id.json");
    expect(d[0].kind).toBe("keypair-path-ref");
  });

  it("ignores placeholder values", () => {
    expect(detectFileSecrets("PRIVATE_KEY=your-key-here")).toHaveLength(0);
    expect(detectFileSecrets("SECRET_KEY=${SECRET_KEY}")).toHaveLength(0);
    expect(detectFileSecrets("PRIVATE_KEY=")).toHaveLength(0);
  });

  it("flags a secret-named var with an unrecognized but real value (low confidence)", () => {
    const d = classifySecretValue("notparseable");
    expect(d).toBeNull(); // value alone isn't secret-shaped …
    const f = detectFileSecrets("WALLET_KEY=notparseable123"); // … but the NAME makes it suspect
    expect(f[0].kind).toBe("env-private-key");
    expect(f[0].confidence).toBe("low");
  });

  it("never leaks the secret value into the detection", () => {
    const d = detectFileSecrets(`SOLANA_PRIVATE_KEY=${BASE58_SECRET}`);
    expect(JSON.stringify(d)).not.toContain(BASE58_SECRET);
  });
});

describe("scan: blast-radius tiering and recovery context", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "keyguard-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("tiers a real keypair as FUNDS and a fixture keypair as TRIVIAL", () => {
    writeFileSync(join(dir, "id.json"), JSON.stringify(KEYPAIR_64));
    mkdirSync(join(dir, "test"));
    writeFileSync(join(dir, "test", "fixture-keypair.json"), JSON.stringify(KEYPAIR_64));
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');

    const report = scanSecrets(dir, { extraPaths: [] });
    const byRel = Object.fromEntries(report.secrets.map((s) => [s.rel, s]));

    expect(byRel["id.json"].tier).toBe("funds");
    expect(byRel["id.json"].needsOnchainCheck).toBe(true);
    expect(byRel[join("test", "fixture-keypair.json")].tier).toBe("trivial");
  });

  it("flags an unbacked high-tier secret as EXPOSED (git can't restore it)", () => {
    writeFileSync(join(dir, ".env"), `SOLANA_PRIVATE_KEY=${BASE58_SECRET}`);
    const report = scanSecrets(dir, { extraPaths: [] });
    expect(report.verdict).toBe("exposed");
    expect(report.summary.unrecoverable).toBeGreaterThanOrEqual(1);
  });

  it("returns OK on a project with no irreplaceable secrets", () => {
    writeFileSync(join(dir, "index.ts"), "export const x = 1;");
    writeFileSync(join(dir, "README.md"), "# hello");
    const report = scanSecrets(dir, { extraPaths: [] });
    expect(report.verdict).toBe("ok");
    expect(report.secrets).toHaveLength(0);
  });

  it("finds program keypairs under target/deploy but skips the rest of target/", () => {
    mkdirSync(join(dir, "target", "deploy"), { recursive: true });
    mkdirSync(join(dir, "target", "release"), { recursive: true });
    writeFileSync(join(dir, "target", "deploy", "prog-keypair.json"), JSON.stringify(KEYPAIR_64));
    writeFileSync(join(dir, "target", "release", "build-artifact.json"), JSON.stringify(KEYPAIR_64));

    const report = scanSecrets(dir, { extraPaths: [] });
    const rels = report.secrets.map((s) => s.rel);
    expect(rels).toContain(join("target", "deploy", "prog-keypair.json"));
    expect(rels).not.toContain(join("target", "release", "build-artifact.json"));
  });
});
