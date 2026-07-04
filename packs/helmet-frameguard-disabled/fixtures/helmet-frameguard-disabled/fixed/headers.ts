import express from "express";
import helmet from "helmet";

export function applyFrameHeaders(app: express.Express) {
  // FIXED: frameguard stays enabled (helmet's secure default).
  app.use(helmet({ frameguard: true }));
  return app;
}
