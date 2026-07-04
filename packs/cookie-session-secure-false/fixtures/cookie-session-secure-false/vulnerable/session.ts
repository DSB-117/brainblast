import express from "express";
import cookieSession from "cookie-session";

export function configureCookieSession(app: express.Express) {
  // VULNERABLE: secure: false sends the session cookie over plain HTTP — it can be sniffed and replayed.
  app.use(cookieSession({
    name: "session",
    keys: [process.env.SESSION_KEY as string],
    secure: false,
    httpOnly: true,
  }));
  return app;
}
