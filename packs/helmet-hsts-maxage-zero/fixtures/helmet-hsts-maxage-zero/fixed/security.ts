import express from "express";
import helmet from "helmet";

export function applySecurityHeaders(app: express.Express) {
  // FIXED: a real max-age keeps browsers pinned to HTTPS for 180 days.
  app.use(helmet.hsts({ maxAge: 15552000, includeSubDomains: true }));
  return app;
}
