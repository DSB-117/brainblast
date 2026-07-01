import jwt from "jsonwebtoken";

// Known-good code the proposed checker MUST NOT flag: same call + property, but
// the algorithms allow-list is safe (no "none"). If the checker fires here, it is
// unsound and the gate rejects it.
export function verifyRs(token: string, key: string) {
  return jwt.verify(token, key, { algorithms: ["RS256"] });
}

export function verifyMulti(token: string, key: string) {
  return jwt.verify(token, key, { algorithms: ["RS256", "ES256"] });
}

// A verify with no algorithms option at all — the checker should abstain, not fail.
export function verifyDefault(token: string, key: string) {
  return jwt.verify(token, key, { ignoreExpiration: false });
}
