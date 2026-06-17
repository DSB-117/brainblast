import type { ConfigChecker } from "../types.ts";

// Vetted checker template: env-secrets-committed.
// params: { secretKeyPattern, placeholderPattern, passDetail, failDetailPrefix,
//           ignoredDetail }
//
// PASS  -> file is git-ignored (not committed), or every KEY=VALUE line whose
//          key matches `secretKeyPattern` either has no value or a
//          placeholder-shaped value (matches `placeholderPattern`).
// FAIL  -> file is tracked/committed AND at least one secret-shaped key has a
//          non-placeholder value.
export const envSecretsCommitted: ConfigChecker = (c, p) => {
  if (!c.tracked) {
    return {
      result: "pass",
      detail: p.ignoredDetail ?? "File is git-ignored; not committed to source control.",
    };
  }

  const keyRe = new RegExp(p.secretKeyPattern, "i");
  const placeholderRe = new RegExp(p.placeholderPattern, "i");
  const offenders: string[] = [];

  for (const rawLine of c.content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;

    const [, key, rawValue] = m;
    if (!keyRe.test(key!)) continue;

    const value = (rawValue ?? "").trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    if (placeholderRe.test(value)) continue;

    offenders.push(key!);
  }

  if (offenders.length > 0) {
    const prefix = p.failDetailPrefix ?? "This file is tracked by git and contains secret-looking values";
    return { result: "fail", detail: `${prefix}: ${offenders.join(", ")}.` };
  }

  return { result: "pass", detail: p.passDetail ?? "No committed secret-looking values found." };
};
