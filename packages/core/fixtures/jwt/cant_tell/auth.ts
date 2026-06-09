// CANT_TELL fixture: imports jose (triggers requiresImport), name matches privy,
// but verification happens through dynamic indirection the static checker cannot
// resolve (no decodeJwt / jwtVerify calls in scope). Checker should warn
// (cant_tell), not claim PASS or FAIL.
import type { JWTPayload } from "jose";
export function verifyPrivyToken(token: string): { userId: string } {
  const claims = resolveClaims(token);
  return { userId: claims.sub };
}

function resolveClaims(_t: string): { sub: string } {
  return { sub: "did:privy:unknown" };
}
