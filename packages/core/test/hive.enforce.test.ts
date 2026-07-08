import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hivePackDirs, hivePaths, HIVE_DIR_ENV, HIVE_DISABLE_ENV } from "../src/hive/store.ts";
import { resolveRules } from "../src/resolveRules.ts";
import { checkWrittenFile, isCheckableFile, renderWriteFeedback } from "../src/hive/enforce.ts";
import { detectOutbreaks, renderOutbreakText } from "../src/hive/outbreak.ts";
import type { HiveRepo } from "../src/hive/store.ts";
import type { CorpusVti } from "../src/corpus.ts";

// A real bundled pack (manifest + rule, no fixtures needed) — the same content
// the hive mirrors from GitHub, so this exercises the actual enforcement path.
const REAL_PACK = resolve(process.cwd(), "../../packs/express-session-cookie-secure-false");
const REAL_RULE_ID = "express-session-cookie-secure-false";

const VULNERABLE_SRC = `import session from "express-session";
import express from "express";

export function configureSession(app: express.Express) {
  app.use(session({
    secret: process.env.SECRET as string,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true },
  }));
  return app;
}
`;

const FIXED_SRC = VULNERABLE_SRC.replace("secure: false", "secure: true");

function installHivePack(hive: string, packDir: string = REAL_PACK): void {
  const dest = join(hivePaths(hive).packsDir, REAL_RULE_ID);
  mkdirSync(dest, { recursive: true });
  cpSync(join(packDir, "brainblast-pack.yaml"), join(dest, "brainblast-pack.yaml"));
  cpSync(join(packDir, "rules"), join(dest, "rules"), { recursive: true });
}

describe("hive enforcement — rule resolution", () => {
  let hive: string;
  let repo: string;
  const envBefore = { hive: process.env[HIVE_DIR_ENV], off: process.env[HIVE_DISABLE_ENV] };
  beforeEach(() => {
    hive = mkdtempSync(join(tmpdir(), "hive-enf-"));
    repo = mkdtempSync(join(tmpdir(), "hive-enf-repo-"));
    process.env[HIVE_DIR_ENV] = hive;
    delete process.env[HIVE_DISABLE_ENV];
  });
  afterEach(() => {
    if (envBefore.hive === undefined) delete process.env[HIVE_DIR_ENV];
    else process.env[HIVE_DIR_ENV] = envBefore.hive;
    if (envBefore.off === undefined) delete process.env[HIVE_DISABLE_ENV];
    else process.env[HIVE_DISABLE_ENV] = envBefore.off;
    rmSync(hive, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("hivePackDirs lists mirrored packs, skips non-packs, and honors the opt-out", () => {
    expect(hivePackDirs()).toEqual([]);
    installHivePack(hive);
    mkdirSync(join(hivePaths(hive).packsDir, "not-a-pack"), { recursive: true });
    expect(hivePackDirs()).toEqual([join(hivePaths(hive).packsDir, REAL_RULE_ID)]);
    process.env[HIVE_DISABLE_ENV] = "1";
    expect(hivePackDirs()).toEqual([]);
  });

  it("resolveRules loads hive packs last and fail-open skips a corrupt one", () => {
    installHivePack(hive);
    const broken = join(hivePaths(hive).packsDir, "broken-pack");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "brainblast-pack.yaml"), "id: [not: valid");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rules = resolveRules(repo);
      expect(rules.some((r) => r.id === REAL_RULE_ID)).toBe(true);
      expect(rules.filter((r) => r.id === REAL_RULE_ID)).toHaveLength(1);
      expect(warn.mock.calls.some(([m]) => String(m).includes("skipping unreadable hive pack"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("a hive copy of an explicitly-passed pack is shadowed silently (explicit wins)", () => {
    installHivePack(hive);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rules = resolveRules(repo, [REAL_PACK]);
      expect(rules.filter((r) => r.id === REAL_RULE_ID)).toHaveLength(1);
      // The explicit pack loaded first; the hive duplicate must not warn.
      expect(warn.mock.calls.some(([m]) => String(m).includes("shadows"))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it("BRAINBLAST_NO_HIVE=1 restores the pre-hive rule set", () => {
    installHivePack(hive);
    process.env[HIVE_DISABLE_ENV] = "1";
    expect(resolveRules(repo).some((r) => r.id === REAL_RULE_ID)).toBe(false);
  });
});

describe("hive enforcement — write-time file check", () => {
  let hive: string;
  let repo: string;
  const envBefore = process.env[HIVE_DIR_ENV];
  beforeEach(() => {
    hive = mkdtempSync(join(tmpdir(), "hive-wt-"));
    repo = mkdtempSync(join(tmpdir(), "hive-wt-repo-"));
    process.env[HIVE_DIR_ENV] = hive;
    installHivePack(hive);
  });
  afterEach(() => {
    if (envBefore === undefined) delete process.env[HIVE_DIR_ENV];
    else process.env[HIVE_DIR_ENV] = envBefore;
    rmSync(hive, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("flags a just-written vulnerable file via a hive-mirrored rule, and clears the fixed form", () => {
    const file = join(repo, "session.ts");
    writeFileSync(file, VULNERABLE_SRC);
    const red = checkWrittenFile(file, repo);
    expect(red.checked).toBe(true);
    expect(red.failures.map((f) => f.ruleId)).toContain(REAL_RULE_ID);

    writeFileSync(file, FIXED_SRC);
    const green = checkWrittenFile(file, repo);
    expect(green.failures).toHaveLength(0);
  });

  it("only the written file is checked — a vulnerable sibling stays out of the feedback", () => {
    writeFileSync(join(repo, "sibling.ts"), VULNERABLE_SRC);
    const file = join(repo, "clean.ts");
    writeFileSync(file, FIXED_SRC);
    const result = checkWrittenFile(file, repo);
    expect(result.checked).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("uncheckable or missing files exit silently", () => {
    expect(isCheckableFile("notes.md")).toBe(false);
    expect(isCheckableFile("src/app.ts")).toBe(true);
    expect(isCheckableFile(".env.local")).toBe(true);
    expect(checkWrittenFile(join(repo, "notes.md"), repo).checked).toBe(false);
    expect(checkWrittenFile(join(repo, "ghost.ts"), repo).checked).toBe(false);
  });

  it("renderWriteFeedback budgets the findings and states the proof bar", () => {
    const file = join(repo, "session.ts");
    writeFileSync(file, VULNERABLE_SRC);
    const result = checkWrittenFile(file, repo);
    const text = renderWriteFeedback(result, 1);
    expect(text).toContain("[HiveMind]");
    expect(text).toContain(REAL_RULE_ID);
    expect(text).toContain("RED→GREEN-proven");
  });
});

describe("hive outbreak detection", () => {
  const repos: HiveRepo[] = [
    { path: "/a", name: "app-a", deps: { "express-session": "^1.18.0" }, linkedAt: "2026-06-01" },
    { path: "/b", name: "app-b", deps: { stripe: "^17.0.0", "express-session": "^1.17.0" }, linkedAt: "2026-06-01" },
    { path: "/c", name: "app-c", deps: { vitest: "^2.0.0" }, linkedAt: "2026-06-01" },
  ];

  function vti(over: Record<string, unknown> = {}): CorpusVti {
    return {
      trapId: "express-session-cookie-secure-false",
      sdk: { name: "express-session" },
      severity: "high",
      class: "auth-bypass",
      redGreenProof: { red: true, green: true },
      capturedAt: "2026-07-01T00:00:00.000Z",
      ...over,
    } as CorpusVti;
  }

  it("crosses new proven traps with linked repos' deps, worst first", () => {
    const outbreaks = detectOutbreaks(
      [vti(), vti({ trapId: "stripe-critical", sdk: { name: "stripe" }, severity: "critical" })],
      repos,
    );
    expect(outbreaks.map((o) => o.trapId)).toEqual(["stripe-critical", "express-session-cookie-secure-false"]);
    expect(outbreaks[0].affected.map((a) => a.name)).toEqual(["app-b"]);
    expect(outbreaks[1].affected.map((a) => a.name)).toEqual(["app-a", "app-b"]);
    expect(renderOutbreakText(outbreaks[0])).toContain("OUTBREAK [CRITICAL] stripe-critical");
  });

  it("ignores unproven records, sub-threshold severities, and unaffected repos", () => {
    expect(detectOutbreaks([vti({ redGreenProof: { red: true, green: false } })], repos)).toEqual([]);
    expect(detectOutbreaks([vti({ severity: "medium" })], repos)).toEqual([]);
    expect(detectOutbreaks([vti({ severity: "medium" })], repos, { minSeverity: "medium" })).toHaveLength(1);
    expect(detectOutbreaks([vti({ sdk: { name: "left-pad" } })], repos)).toEqual([]);
  });
});
