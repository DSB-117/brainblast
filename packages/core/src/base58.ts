// Base58 (Bitcoin alphabet) encode + decode — the representation Solana uses for
// addresses, secret keys, and signatures. Used by the marketplace's ed25519
// grants so a distributor identity IS a Solana-style address. Vendored (no
// dependency) to keep the security path's footprint minimal and auditable.
//
// `base58Encode` mirrors the encode-only copy in src/wallet/agentWallet.ts; this
// module adds the decode the grant-verify path needs.

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

const BASE58_MAP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) m[BASE58_ALPHABET[i]] = i;
  return m;
})();

// Throws on any non-base58 character — callers treat a throw as malformed input.
export function base58Decode(str: string): Buffer {
  if (str.length === 0) return Buffer.alloc(0);
  const bytes: number[] = [];
  for (const ch of str) {
    const val = BASE58_MAP[ch];
    if (val === undefined) throw new Error(`invalid base58 character: ${JSON.stringify(ch)}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading '1' in the input is a leading zero byte.
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}
