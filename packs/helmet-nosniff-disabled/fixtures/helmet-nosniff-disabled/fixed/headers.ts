import express from "express";
import helmet from "helmet";

export function applyHeaders(app: express.Express) {
  // FIXED: noSniff stays enabled (helmet's secure default).
  app.use(helmet({ noSniff: true }));
  return app;
}
