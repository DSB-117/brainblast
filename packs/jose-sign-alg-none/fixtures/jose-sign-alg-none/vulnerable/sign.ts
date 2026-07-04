import { SignJWT } from "jose";

export function issueToken(payload: Record<string, unknown>, key: Uint8Array) {
  // VULNERABLE: alg "none" issues an unsigned token — anyone can forge one with arbitrary claims.
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "none" })
    .setExpirationTime("1h")
    .sign(key);
}
