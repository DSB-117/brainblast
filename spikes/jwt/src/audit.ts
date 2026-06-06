import { findTokenVerifiers } from "./finder.ts";
import { checkTokenVerification, type CheckResult } from "./check.ts";
import { buildReport } from "./emit.ts";

export function audit(targetDir: string) {
  const candidates = findTokenVerifiers(targetDir);
  const checks: CheckResult[] = candidates.map(checkTokenVerification);
  const report = buildReport(targetDir, checks);
  return { candidates, checks, report };
}
