import express from "express";
import helmet from "helmet";

export function applySecurityHeaders(app: express.Express) {
  // VULNERABLE: maxAge: 0 expires HSTS immediately — the site can be downgraded to HTTP and MITM'd.
  app.use(helmet.hsts({ maxAge: 0, includeSubDomains: true }));
  return app;
}
