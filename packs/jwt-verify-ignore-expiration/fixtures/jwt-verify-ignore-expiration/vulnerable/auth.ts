import jwt from "jsonwebtoken";

export function verifySession(token: string, secret: string) {
  // VULNERABLE: ignoreExpiration disables the exp check — expired/stolen tokens stay valid forever.
  return jwt.verify(token, secret, { ignoreExpiration: true });
}
