import { Strategy, ExtractJwt } from "passport-jwt";

export function makeJwtStrategy(secret: string) {
  // FIXED: expiry is enforced — expired tokens are rejected.
  return new Strategy(
    { jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: secret },
    (payload, done) => done(null, payload),
  );
}
