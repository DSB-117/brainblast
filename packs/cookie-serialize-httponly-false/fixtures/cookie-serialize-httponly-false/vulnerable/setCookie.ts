import { serialize } from "cookie";

export function authCookie(token: string) {
  // VULNERABLE: httpOnly: false lets client-side JS read the auth cookie — any XSS steals the session.
  return serialize("token", token, { httpOnly: false, secure: true, sameSite: "lax", path: "/" });
}
