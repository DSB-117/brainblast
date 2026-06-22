// Keyguard — the Vault: out-of-band, encrypted recovery for irreplaceable secrets.
//
// Why this has to exist: the files most worth protecting (keypairs, .env, seed
// phrases) are *correctly gitignored*, so git can never restore them. The Vault
// is Brainblast's own safety net — encrypted snapshots, content-addressed and
// versioned, stored OUTSIDE any repo so a `git clean -fdx` / `rm -rf` can't reach
// them. It is recovery-focused (defending against accidental deletion); the
// encryption keeps the backup from becoming a second plaintext-secret location.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const MAGIC = Buffer.from("BBV1");
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

export interface VaultEntry {
  path: string; // absolute original path
  hash: string; // sha256 of the plaintext content (object id)
  ts: string; // ISO timestamp of this snapshot
  size: number;
  pubkey?: string;
  kind?: string;
  tier?: string;
}

interface VaultIndex {
  version: string;
  entries: VaultEntry[];
}

export function vaultDir(): string {
  return process.env.BRAINBLAST_VAULT_DIR
    ? resolve(process.env.BRAINBLAST_VAULT_DIR)
    : join(homedir(), ".brainblast", "vault");
}

function objectsDir(): string {
  return join(vaultDir(), "objects");
}
function indexPath(): string {
  return join(vaultDir(), "index.json");
}
function keyFilePath(): string {
  return join(vaultDir(), "key");
}

function ensureVault(): void {
  mkdirSync(objectsDir(), { recursive: true });
}

// The master secret: a user-supplied passphrase if set (nothing stored on disk),
// otherwise a locally-generated 32-byte key persisted at 0600. Same source at
// backup and restore time is all that's required.
function masterSecret(): string {
  const pass = process.env.BRAINBLAST_VAULT_PASSPHRASE;
  if (pass && pass.length > 0) return pass;
  ensureVault();
  const kf = keyFilePath();
  if (!existsSync(kf)) {
    writeFileSync(kf, randomBytes(32).toString("hex"), { mode: 0o600 });
    try {
      chmodSync(kf, 0o600);
    } catch {
      /* platform may ignore */
    }
  }
  return readFileSync(kf, "utf8").trim();
}

function encrypt(plain: Buffer): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = scryptSync(masterSecret(), salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ct]);
}

function decrypt(blob: Buffer): Buffer {
  if (blob.length < 4 + SALT_LEN + IV_LEN + TAG_LEN || !blob.subarray(0, 4).equals(MAGIC)) {
    throw new Error("vault object is corrupt or not a Brainblast vault blob");
  }
  let o = 4;
  const salt = blob.subarray(o, (o += SALT_LEN));
  const iv = blob.subarray(o, (o += IV_LEN));
  const tag = blob.subarray(o, (o += TAG_LEN));
  const ct = blob.subarray(o);
  const key = scryptSync(masterSecret(), salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function loadIndex(): VaultIndex {
  const p = indexPath();
  if (!existsSync(p)) return { version: "1", entries: [] };
  try {
    return JSON.parse(readFileSync(p, "utf8")) as VaultIndex;
  } catch {
    return { version: "1", entries: [] };
  }
}

function saveIndex(ix: VaultIndex): void {
  ensureVault();
  writeFileSync(indexPath(), JSON.stringify(ix, null, 2), { mode: 0o600 });
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface BackupMeta {
  pubkey?: string;
  kind?: string;
  tier?: string;
}

// Snapshot a file into the vault. Content-addressed: identical content is stored
// once. Always appends an index entry (so history is preserved).
export function backupFile(filePath: string, meta: BackupMeta = {}): { hash: string; deduped: boolean } {
  const abs = resolve(filePath);
  const plain = readFileSync(abs);
  const hash = sha256(plain);
  ensureVault();
  const objPath = join(objectsDir(), `${hash}.enc`);
  let deduped = true;
  if (!existsSync(objPath)) {
    writeFileSync(objPath, encrypt(plain), { mode: 0o600 });
    deduped = false;
  }
  const ix = loadIndex();
  ix.entries.push({
    path: abs,
    hash,
    ts: new Date().toISOString(),
    size: plain.length,
    pubkey: meta.pubkey,
    kind: meta.kind,
    tier: meta.tier,
  });
  saveIndex(ix);
  return { hash, deduped };
}

function entriesForPath(abs: string, ix = loadIndex()): VaultEntry[] {
  return ix.entries.filter((e) => e.path === abs).sort((a, b) => b.ts.localeCompare(a.ts));
}

export interface VaultStatus {
  backedUp: boolean; // any snapshot exists for this path
  currentMatches: boolean; // the file's CURRENT content is backed up
  latest?: VaultEntry;
  versions: number;
}

export function statusForPath(filePath: string): VaultStatus {
  const abs = resolve(filePath);
  const entries = entriesForPath(abs);
  if (entries.length === 0) return { backedUp: false, currentMatches: false, versions: 0 };
  const latest = entries[0];
  let currentMatches = false;
  if (existsSync(abs)) {
    try {
      currentMatches = entries.some((e) => e.hash === sha256(readFileSync(abs)));
    } catch {
      currentMatches = false;
    }
  }
  return { backedUp: true, currentMatches, latest, versions: entries.length };
}

// The flag the scan consumes: is the thing you'd lose RIGHT NOW safe? (If the
// file is gone, any snapshot counts; if it's present, its current content must be.)
export function isBackedUp(filePath: string): boolean {
  const st = statusForPath(filePath);
  if (!st.backedUp) return false;
  return existsSync(resolve(filePath)) ? st.currentMatches : true;
}

// Restore the latest snapshot for a path (or, if `byPubkey`, the latest entry
// whose pubkey matches). Refuses to clobber an existing file unless `force`.
export function restore(
  query: string,
  opts: { to?: string; force?: boolean; byPubkey?: boolean } = {},
): { restoredTo: string; hash: string; ts: string } {
  const ix = loadIndex();
  let entries: VaultEntry[];
  if (opts.byPubkey) {
    entries = ix.entries.filter((e) => e.pubkey === query).sort((a, b) => b.ts.localeCompare(a.ts));
  } else {
    entries = entriesForPath(resolve(query), ix);
  }
  if (entries.length === 0) throw new Error(`vault: no snapshot found for ${query}`);
  const entry = entries[0];
  const dest = resolve(opts.to ?? entry.path);
  if (existsSync(dest) && !opts.force) {
    throw new Error(`vault: ${dest} already exists; pass --force to overwrite`);
  }
  const objPath = join(objectsDir(), `${entry.hash}.enc`);
  if (!existsSync(objPath)) throw new Error(`vault: object ${entry.hash} missing`);
  const plain = decrypt(readFileSync(objPath));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, plain, { mode: 0o600 });
  return { restoredTo: dest, hash: entry.hash, ts: entry.ts };
}

// Soft-delete: back the file up, then remove it. The agent's intent ("clean
// this up") succeeds, but nothing irreplaceable is actually destroyed.
export function trash(filePath: string, meta: BackupMeta = {}): { hash: string } {
  const abs = resolve(filePath);
  const { hash } = backupFile(abs, meta);
  unlinkSync(abs);
  return { hash };
}

export function listEntries(): VaultEntry[] {
  return loadIndex().entries.slice().sort((a, b) => b.ts.localeCompare(a.ts));
}

// Latest snapshot per distinct path (for `vault list` / `vault status`).
export function listLatestByPath(): VaultEntry[] {
  const byPath = new Map<string, VaultEntry>();
  for (const e of listEntries()) {
    if (!byPath.has(e.path)) byPath.set(e.path, e);
  }
  return [...byPath.values()];
}

// Best-effort sanity: every referenced object exists on disk.
export function verifyVault(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!existsSync(objectsDir())) return { ok: true, missing };
  const present = new Set(readdirSync(objectsDir()).filter((f) => f.endsWith(".enc")).map((f) => f.slice(0, -4)));
  for (const e of loadIndex().entries) {
    if (!present.has(e.hash) && !missing.includes(e.hash)) missing.push(e.hash);
  }
  return { ok: missing.length === 0, missing };
}

export function _vaultSizeBytes(): number {
  if (!existsSync(objectsDir())) return 0;
  let total = 0;
  for (const f of readdirSync(objectsDir())) {
    try {
      total += statSync(join(objectsDir(), f)).size;
    } catch {
      /* ignore */
    }
  }
  return total;
}
