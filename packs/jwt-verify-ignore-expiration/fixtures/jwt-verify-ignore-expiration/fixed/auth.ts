import jwt from "jsonwebtoken";

export function verifySession(token: string, secret: string) {
  // FIXED: expiry is enforced — an expired token is rejected.
  return jwt.verify(token, secret, { ignoreExpiration: false });
}
