import { expressjwt } from 'express-jwt';

// Express middleware factory — the audited scope.
export function authMiddleware() {
  // VULNERABLE: ignoreNotBefore disables 'nbf' enforcement, so future-dated /
  // not-yet-valid tokens are accepted.
  return expressjwt({
    secret: 'shhhhhhared-secret',
    algorithms: ['HS256'],
    ignoreNotBefore: true,
  });
}
