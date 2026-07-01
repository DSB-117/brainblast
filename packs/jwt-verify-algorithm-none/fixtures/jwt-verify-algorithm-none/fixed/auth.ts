import jwt from "jsonwebtoken";

export function verifyToken(token: string, key: string) {
  // FIXED: only real signing algorithms are accepted.
  return jwt.verify(token, key, { algorithms: ["HS256"] });
}
