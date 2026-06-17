// FIXED: only a non-secret status string crosses into the logging helper.
import { logIt } from "./helper.ts";

export function debugHandler() {
  logIt("handler called");
  return { ok: true };
}
