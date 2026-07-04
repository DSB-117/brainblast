import jwt from "jsonwebtoken";

export function issueToken(payload: object, secret: string) {
  // FIXED: a real signing algorithm produces a verifiable signature.
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "1h" });
}
