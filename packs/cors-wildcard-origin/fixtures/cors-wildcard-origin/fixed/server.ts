import express from "express";
import cors from "cors";

export function makeApp() {
  const app = express();
  // FIXED: only the trusted front-end origin may make cross-origin requests.
  app.use(cors({ origin: "https://app.example.com", credentials: true }));
  return app;
}
