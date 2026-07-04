import { SignJWT } from "jose";

export function issueToken(payload: Record<string, unknown>, key: Uint8Array) {
  // FIXED: a real signing algorithm produces a verifiable signature.
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(key);
}
