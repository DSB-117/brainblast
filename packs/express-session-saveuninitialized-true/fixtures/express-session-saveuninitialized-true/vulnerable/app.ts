import session from "express-session";
import express from "express";

export function configureSession(app: express.Express) {
  // VULNERABLE: saveUninitialized: true persists empty, unauthenticated sessions —
  // enabling session fixation and unbounded store growth from anonymous traffic.
  app.use(session({
    secret: process.env.SECRET as string,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
  }));
  return app;
}
