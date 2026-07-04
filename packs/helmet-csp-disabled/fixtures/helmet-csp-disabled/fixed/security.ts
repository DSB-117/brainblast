import express from "express";
import helmet from "helmet";

export function applySecurityHeaders(app: express.Express) {
  // FIXED: CSP stays enabled (helmet's secure default).
  app.use(helmet({ contentSecurityPolicy: true }));
  return app;
}
