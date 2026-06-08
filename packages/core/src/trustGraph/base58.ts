// Minimal base58 codec (Bitcoin alphabet — same as Solana). No deps. We need
// it for encoding ProgramData/authority pubkeys back to canonical addresses
// when reading raw account bytes from RPC.

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP: Record<string, number> = {};
for (let i = 0; i < ALPHA.length; i++) MAP[ALPHA[i]] = i;

export function base58Encode(bytes: Uint8Array): string {
  // Count leading zero bytes; each becomes a leading '1'.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Convert from base-256 to base-58 via repeated long-division.
  const buf = Array.from(bytes);
  const out: number[] = [];
  let start = zeros;
  while (start < buf.length) {
    let rem = 0;
    for (let i = start; i < buf.length; i++) {
      const acc = rem * 256 + buf[i];
      buf[i] = Math.floor(acc / 58);
      rem = acc % 58;
    }
    out.push(rem);
    if (buf[start] === 0) start++;
  }

  let s = "";
  for (let i = 0; i < zeros; i++) s += "1";
  for (let i = out.length - 1; i >= 0; i--) s += ALPHA[out[i]];
  return s;
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;

  const buf: number[] = [];
  for (let i = zeros; i < s.length; i++) {
    const v = MAP[s[i]];
    if (v === undefined) throw new Error(`base58: invalid char '${s[i]}' at ${i}`);
    let carry = v;
    for (let j = 0; j < buf.length; j++) {
      const acc = buf[j] * 58 + carry;
      buf[j] = acc & 0xff;
      carry = acc >>> 8;
    }
    while (carry > 0) {
      buf.push(carry & 0xff);
      carry >>>= 8;
    }
  }

  const out = new Uint8Array(zeros + buf.length);
  for (let i = 0; i < buf.length; i++) out[zeros + buf.length - 1 - i] = buf[i];
  return out;
}

export function isValidSolanaAddress(s: string): boolean {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    return base58Decode(s).length === 32;
  } catch {
    return false;
  }
}
