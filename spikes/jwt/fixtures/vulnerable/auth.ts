// VULNERABLE FIXTURE.
// Decodes the Privy access token WITHOUT verifying its signature, audience, or
// issuer. Any forged token (or a token from another Privy app) is trusted.
import { decodeJwt } from "jose";

export function verifyPrivyToken(token: string) {
  const claims = decodeJwt(token); // no signature/aud/iss check -> auth bypass
  return { userId: claims.sub };
}
