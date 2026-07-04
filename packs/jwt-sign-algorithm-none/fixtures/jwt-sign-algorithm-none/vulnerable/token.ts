import jwt from "jsonwebtoken";

export function issueToken(payload: object, secret: string) {
  // VULNERABLE: algorithm "none" issues an UNSIGNED token — anyone can forge one with arbitrary claims.
  return jwt.sign(payload, secret, { algorithm: "none", expiresIn: "1h" });
}
