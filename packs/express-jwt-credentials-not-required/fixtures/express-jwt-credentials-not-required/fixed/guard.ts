import { expressjwt } from "express-jwt";

export function requireAuth(secret: string) {
  // FIXED: a valid token is required; anonymous requests are rejected.
  return expressjwt({ secret, algorithms: ["HS256"], credentialsRequired: true });
}
