// VULNERABLE: decodes the access token without verifying signature/aud/iss.
import { decodeJwt } from "jose";

export function verifyPrivyToken(token: string) {
  const claims = decodeJwt(token);
  return { userId: claims.sub };
}
