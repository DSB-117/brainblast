import jwt from "jsonwebtoken";

export function verifyToken(token: string, key: string) {
  // VULNERABLE: "none" in the allow-list accepts unsigned, forged tokens.
  return jwt.verify(token, key, { algorithms: ["none", "HS256"] });
}
