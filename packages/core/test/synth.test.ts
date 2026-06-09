import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { renderRuleYaml, stageFinding, writeDraft } from "../src/synth/index.ts";
import type { Finding } from "../src/synth/index.ts";
import { loadRules } from "../src/loadRules.ts";
import { audit } from "../src/audit.ts";
import { checkerKinds } from "../src/checkers/index.ts";
import { testKinds } from "../src/testTemplates/index.ts";

const bagsFinding: Finding = JSON.parse(
  readFileSync(new URL("../findings/bags-known-answer.json", import.meta.url), "utf8"),
);

const anchorFinding: Finding = JSON.parse(
  readFileSync(new URL("../findings/anchor-init-if-needed-reinit.json", import.meta.url), "utf8"),
);

describe("synth.renderRuleYaml", () => {
  it("renders a YAML rule whose facts round-trip through loadRules", () => {
    const yaml = renderRuleYaml(bagsFinding);
    const parsed = parse(yaml);
    expect(parsed.id).toBe(bagsFinding.id);
    expect(parsed.severity).toBe(bagsFinding.severity);
    expect(parsed.check.kind).toBe(bagsFinding.binding.check.kind);
    expect(parsed.test.kind).toBe(bagsFinding.binding.test.kind);
    // check.params survive verbatim (no executable code, just data)
    expect(parsed.check.params.bpsTotal).toBe(10000);
  });
});

describe("synth.stageFinding", () => {
  it("writes a rule + matching vulnerable/fixed fixtures that loadRules accepts", () => {
    const tmp = mkdtempSync(join(tmpdir(), "synth-"));
    try {
      const { ruleFile, vulnerableDir, fixedDir } = stageFinding(tmp, bagsFinding);
      expect(existsSync(ruleFile)).toBe(true);
      expect(existsSync(join(vulnerableDir, "feeconfig.ts"))).toBe(true);
      expect(existsSync(join(fixedDir, "feeconfig.ts"))).toBe(true);
      const rules = loadRules(join(tmp, bagsFinding.id, "rules"));
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe(bagsFinding.id);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("synth.writeDraft", () => {
  it("writes finding.json + sketch.md when binding fails", () => {
    const tmp = mkdtempSync(join(tmpdir(), "synth-draft-"));
    try {
      const dir = writeDraft(tmp, bagsFinding, "test: unfit binding");
      expect(existsSync(join(dir, "finding.json"))).toBe(true);
      expect(existsSync(join(dir, "sketch.md"))).toBe(true);
      const sketch = readFileSync(join(dir, "sketch.md"), "utf8");
      expect(sketch).toContain("DRAFT");
      expect(sketch).toContain("test: unfit binding");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// Negative-path regression: a Finding that binds to an unvetted checker kind
// (anchor-init-if-needed-guarded / anchor-program-test) must be blocked at Gate 1.
// This ensures the vetted-kind safety net stays intact as new checker kinds are
// added — any accidental removal from the registry would surface here first.
describe("synth.draft-gate (trap #4: init_if_needed)", () => {
  it("routes to DRAFT because both kinds are outside the vetted registries", () => {
    expect(checkerKinds).not.toContain(anchorFinding.binding.check.kind);
    expect(testKinds).not.toContain(anchorFinding.binding.test.kind);
  });

  it("writeDraft produces a sketch.md that names both missing kinds", () => {
    const tmp = mkdtempSync(join(tmpdir(), "synth-anchor-draft-"));
    try {
      const reason = [
        !checkerKinds.includes(anchorFinding.binding.check.kind)
          ? `check.kind '${anchorFinding.binding.check.kind}' is not in the vetted registry`
          : null,
        !testKinds.includes(anchorFinding.binding.test.kind)
          ? `test.kind '${anchorFinding.binding.test.kind}' is not in the vetted registry`
          : null,
      ]
        .filter(Boolean)
        .join("; ");
      const dir = writeDraft(tmp, anchorFinding, reason);
      const sketch = readFileSync(join(dir, "sketch.md"), "utf8");
      expect(sketch).toContain("anchor-init-if-needed-guarded");
      expect(sketch).toContain("anchor-program-test");
      expect(sketch).toContain("DRAFT");
      // The candidate YAML should document the intended shape for Phase 2.5
      expect(sketch).toContain("init_if_needed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// THE known-answer regression: the Bags Finding, fed through the full
// proof-as-classifier loop, must reproduce the same RED->GREEN result as the
// hand-built rule. If this ever goes red, the pipeline drifted away from the
// behavior of the production checker — Phase 0's "done when" criterion broke.
describe("synth.proof-as-classifier (known answer: Bags)", () => {
  it("re-derives the Bags rule with RED on vulnerable and GREEN on fixed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "synth-known-"));
    try {
      const { vulnerableDir, fixedDir } = stageFinding(tmp, bagsFinding);
      const rules = loadRules(join(tmp, bagsFinding.id, "rules"));

      const vuln = audit(vulnerableDir, rules);
      expect(vuln.checks).toHaveLength(1);
      expect(vuln.checks[0].ruleId).toBe(bagsFinding.id);
      expect(vuln.checks[0].result).toBe("fail");

      const fixed = audit(fixedDir, rules);
      expect(fixed.checks).toHaveLength(1);
      expect(fixed.checks[0].ruleId).toBe(bagsFinding.id);
      expect(fixed.checks[0].result).toBe("pass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
