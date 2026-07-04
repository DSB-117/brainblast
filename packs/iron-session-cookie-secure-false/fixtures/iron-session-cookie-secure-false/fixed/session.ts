import { getIronSession } from "iron-session";
import type { IncomingMessage, ServerResponse } from "node:http";

export function loadSession(req: IncomingMessage, res: ServerResponse, password: string) {
  // FIXED: cookieOptions.secure: true — the session cookie is only sent over HTTPS.
  return getIronSession(req, res, { password, cookieName: "sid", cookieOptions: { secure: true } });
}
