import express from "express";
import cors from "cors";

export function makeApp() {
  const app = express();
  // VULNERABLE: origin: true reflects the caller's Origin; with credentials this lets any site read authenticated responses.
  app.use(cors({ origin: true, credentials: true }));
  return app;
}
