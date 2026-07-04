import jwt from "jsonwebtoken";

export function signToken(payload: object, secret: string) {
  // VULNERABLE: allowInsecureKeySizes: true disables the RSA minimum-key-size guard, so the token is signed with a brute-forceable key.
  return jwt.sign(payload, secret, { algorithm: "HS256", allowInsecureKeySizes: true, expiresIn: 86400 });
}
