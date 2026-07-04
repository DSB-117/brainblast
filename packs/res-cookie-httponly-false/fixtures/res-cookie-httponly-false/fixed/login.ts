import type { Response } from "express";

export function loginHandler(res: Response, token: string) {
  // FIXED: httpOnly: true keeps the auth cookie out of document.cookie.
  res.cookie("token", token, { httpOnly: true, secure: true, sameSite: "lax" });
  return res.sendStatus(200);
}
