import { serialize } from "cookie";

export function authCookie(token: string) {
  // FIXED: httpOnly: true keeps the auth cookie out of document.cookie.
  return serialize("token", token, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}
