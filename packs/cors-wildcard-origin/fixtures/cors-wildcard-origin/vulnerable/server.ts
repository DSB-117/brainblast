import express from "express";
import cors from "cors";

export function makeApp() {
  const app = express();
  // VULNERABLE: any origin may call the API — combined with credentials this is a CSRF/session-theft vector.
  app.use(cors({ origin: "*", credentials: true }));
  return app;
}
