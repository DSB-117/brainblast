import session from "express-session";
import express from "express";

export function configureSession(app: express.Express) {
  // FIXED: sameSite: "lax" keeps the session cookie off cross-site requests.
  app.use(session({
    secret: process.env.SECRET as string,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, sameSite: "lax" },
  }));
  return app;
}
