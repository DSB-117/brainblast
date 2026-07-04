import { expressjwt } from "express-jwt";

export function requireAuth(secret: string) {
  // VULNERABLE: credentialsRequired: false lets tokenless requests reach the protected route.
  return expressjwt({ secret, algorithms: ["HS256"], credentialsRequired: false });
}
