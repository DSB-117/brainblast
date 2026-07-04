import session from "express-session";
import express from "express";

export function configureSession(app: express.Express) {
  // FIXED: saveUninitialized: false — a session is only stored once it is modified
  // (e.g. after login), preventing empty-session persistence and fixation.
  app.use(session({
    secret: process.env.SECRET as string,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
  }));
  return app;
}
