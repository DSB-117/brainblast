import { expressjwt } from 'express-jwt';

// Express middleware factory — the audited scope.
export function authMiddleware() {
  // FIXED: 'nbf' (not-before) enforcement kept on (the secure default, explicit here).
  return expressjwt({
    secret: 'shhhhhhared-secret',
    algorithms: ['HS256'],
    ignoreNotBefore: false,
  });
}
