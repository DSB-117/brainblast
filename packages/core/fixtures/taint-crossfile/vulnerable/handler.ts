// VULNERABLE: a secret-shaped env value is passed across files into a
// generic logging helper.
import { logIt } from "./helper.ts";

export function debugHandler() {
  logIt(process.env.STRIPE_API_KEY);
  return { ok: true };
}
