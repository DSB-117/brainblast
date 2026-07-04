import { getIronSession } from "iron-session";
import type { IncomingMessage, ServerResponse } from "node:http";

export function loadSession(req: IncomingMessage, res: ServerResponse, password: string) {
  // VULNERABLE: cookieOptions.secure: false sends the sealed session cookie over plain HTTP.
  return getIronSession(req, res, { password, cookieName: "sid", cookieOptions: { secure: false } });
}
