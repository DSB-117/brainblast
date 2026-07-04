import jwt from "jsonwebtoken";

export function signToken(payload: object, secret: string) {
  // FIXED: allowInsecureKeySizes: false keeps the minimum-key-size check enforced.
  return jwt.sign(payload, secret, { algorithm: "HS256", allowInsecureKeySizes: false, expiresIn: 86400 });
}
