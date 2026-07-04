import express from "express";
import helmet from "helmet";

export function applyHeaders(app: express.Express) {
  // VULNERABLE: noSniff: false lets browsers MIME-sniff responses into executable HTML/JS.
  app.use(helmet({ noSniff: false }));
  return app;
}
