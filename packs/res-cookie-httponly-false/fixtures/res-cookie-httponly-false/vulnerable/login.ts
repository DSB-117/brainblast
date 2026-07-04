import type { Response } from "express";

export function loginHandler(res: Response, token: string) {
  // VULNERABLE: httpOnly: false lets client-side JS read the auth cookie — any XSS steals the session.
  res.cookie("token", token, { httpOnly: false, secure: true, sameSite: "lax" });
  return res.sendStatus(200);
}
