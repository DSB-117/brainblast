import { findStripeWebhookHandlers } from "./finder.ts";
import { checkRawBodyVerification, type CheckResult } from "./check.ts";
import { buildReport } from "./emit.ts";

// detect -> find -> check -> emit. Spike-local orchestration; the shared
// @brainblast/core is extracted in T3 once the JWT trap (T2) also exists.
export function audit(targetDir: string) {
  const candidates = findStripeWebhookHandlers(targetDir);
  const checks: CheckResult[] = candidates.map(checkRawBodyVerification);
  const report = buildReport(targetDir, checks);
  return { candidates, checks, report };
}
