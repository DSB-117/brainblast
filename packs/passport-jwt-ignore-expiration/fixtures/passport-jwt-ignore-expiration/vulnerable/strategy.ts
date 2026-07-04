import { Strategy, ExtractJwt } from "passport-jwt";

export function makeJwtStrategy(secret: string) {
  // VULNERABLE: ignoreExpiration: true accepts expired tokens forever — expiry stops meaning anything.
  return new Strategy(
    { jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: true, secretOrKey: secret },
    (payload, done) => done(null, payload),
  );
}
