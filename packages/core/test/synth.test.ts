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

// Phase 2.5 promotion: anchor-init-if-needed-guarded and anchor-program-test are
// now in the vetted registries. The trap #4 Finding must PROVE (not DRAFT) —
// tree-sitter-rust finds the candidate, the checker fires RED on vulnerable
// and GREEN on fixed, and the loop closes automatically.
describe("synth.proof-as-classifier (known answer: Anchor init_if_needed)", () => {
  it("both kinds are now in the vetted registries (Phase 2.5)", () => {
    expect(checkerKinds).toContain(anchorFinding.binding.check.kind);
    expect(testKinds).toContain(anchorFinding.binding.test.kind);
  });

  it("re-derives the init_if_needed rule with RED on vulnerable and GREEN on fixed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "synth-anchor-proven-"));
    try {
      const { vulnerableDir, fixedDir } = stageFinding(tmp, anchorFinding);
      const rules = loadRules(join(tmp, anchorFinding.id, "rules"));
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe(anchorFinding.id);

      const vuln = audit(vulnerableDir, rules);
      expect(vuln.checks).toHaveLength(1);
      expect(vuln.checks[0].ruleId).toBe(anchorFinding.id);
      expect(vuln.checks[0].result).toBe("fail");

      const fixed = audit(fixedDir, rules);
      expect(fixed.checks).toHaveLength(1);
      expect(fixed.checks[0].ruleId).toBe(anchorFinding.id);
      expect(fixed.checks[0].result).toBe("pass");
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
