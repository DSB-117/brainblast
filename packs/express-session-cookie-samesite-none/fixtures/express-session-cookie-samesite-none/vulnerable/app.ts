import session from "express-session";
import express from "express";

export function configureSession(app: express.Express) {
  // VULNERABLE: sameSite: "none" sends the session cookie cross-site, removing the SameSite CSRF defense.
  app.use(session({
    secret: process.env.SECRET as string,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, sameSite: "none" },
  }));
  return app;
}
