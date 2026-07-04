import session from "express-session";
import express from "express";

export function configureSession(app: express.Express) {
  // VULNERABLE: cookie.secure: false sends the session cookie over plain HTTP — it can be sniffed.
  app.use(session({
    secret: process.env.SECRET as string,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true },
  }));
  return app;
}
