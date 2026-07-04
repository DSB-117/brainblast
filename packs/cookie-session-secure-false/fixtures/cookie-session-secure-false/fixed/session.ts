import express from "express";
import cookieSession from "cookie-session";

export function configureCookieSession(app: express.Express) {
  // FIXED: secure: true — the session cookie is only sent over HTTPS.
  app.use(cookieSession({
    name: "session",
    keys: [process.env.SESSION_KEY as string],
    secure: true,
    httpOnly: true,
  }));
  return app;
}
