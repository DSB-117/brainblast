import express from "express";
import helmet from "helmet";

export function applyHsts(app: express.Express) {
  // VULNERABLE: hsts: false removes Strict-Transport-Security — the site can be downgraded to HTTP.
  app.use(helmet({ hsts: false }));
  return app;
}
