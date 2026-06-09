// CANT_TELL fixture: matches the rule by name, but verification happens through
// dynamic indirection the static checker cannot resolve. The checker should warn
// (cant_tell), not claim PASS or FAIL.
export function verifyPrivyToken(token: string): { userId: string } {
  const claims = resolveClaims(token);
  return { userId: claims.sub };
}

function resolveClaims(_t: string): { sub: string } {
  return { sub: "did:privy:unknown" };
}
