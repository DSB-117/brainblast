import express from "express";
import helmet from "helmet";

export function applyHsts(app: express.Express) {
  // FIXED: HSTS stays enabled (helmet's secure default).
  app.use(helmet({ hsts: true }));
  return app;
}
