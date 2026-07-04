import express from "express";
import cookieSession from "cookie-session";

export function configureCookieSession(app: express.Express) {
  // FIXED: httpOnly: true keeps the session cookie out of document.cookie.
  app.use(cookieSession({
    name: "session",
    keys: [process.env.SESSION_KEY as string],
    httpOnly: true,
    secure: true,
  }));
  return app;
}
