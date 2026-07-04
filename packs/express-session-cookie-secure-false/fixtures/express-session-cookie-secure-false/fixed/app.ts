import session from "express-session";
import express from "express";

export function configureSession(app: express.Express) {
  // FIXED: cookie.secure: true — the session cookie is only sent over HTTPS.
  app.use(session({
    secret: process.env.SECRET as string,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true },
  }));
  return app;
}
