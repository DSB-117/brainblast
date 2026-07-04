import express from "express";
import helmet from "helmet";

export function applyFrameHeaders(app: express.Express) {
  // VULNERABLE: frameguard: false removes X-Frame-Options — the app can be framed for clickjacking.
  app.use(helmet({ frameguard: false }));
  return app;
}
