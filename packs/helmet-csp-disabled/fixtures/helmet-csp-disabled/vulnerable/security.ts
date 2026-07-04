import express from "express";
import helmet from "helmet";

export function applySecurityHeaders(app: express.Express) {
  // VULNERABLE: contentSecurityPolicy: false ships no CSP header — the main XSS mitigation is gone.
  app.use(helmet({ contentSecurityPolicy: false }));
  return app;
}
