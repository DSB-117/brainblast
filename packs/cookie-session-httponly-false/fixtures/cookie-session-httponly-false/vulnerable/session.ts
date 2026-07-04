import express from "express";
import cookieSession from "cookie-session";

export function configureCookieSession(app: express.Express) {
  // VULNERABLE: httpOnly: false exposes the session cookie to JS — any XSS steals the session.
  app.use(cookieSession({
    name: "session",
    keys: [process.env.SESSION_KEY as string],
    httpOnly: false,
    secure: true,
  }));
  return app;
}
