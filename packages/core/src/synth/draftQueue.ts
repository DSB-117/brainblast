import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import type { Finding } from "./types.ts";

// Write a Finding to the draft queue for human review. Used when:
//   - the Finding binds to a `check.kind` that doesn't exist in the vetted
//     registry (the "we don't have a checker for this shape yet" path), OR
//   - the staged rule loads cleanly but fails RED->GREEN (the synthesizer's
//     binding choice was structurally wrong; needs a human to re-bind or
//     escalate to a new checker kind).
//
// The draft directory is what a human looks at; nothing here is auto-promoted.
export function writeDraft(
  draftsRoot: string,
  f: Finding,
  reason: string,
): string {
  const dir = join(draftsRoot, f.id);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, "finding.json"),
    JSON.stringify(f, null, 2) + "\n",
    "utf8",
  );

  const sketchHeader =
    "# DRAFT — needs human review\n\n" +
    `**Reason:** ${reason}\n\n` +
    "This Finding could not be auto-promoted to a committed rule.\n" +
    "A human must either:\n\n" +
    "1. **Rebind** — pick a different existing `check.kind` whose semantics fit, OR\n" +
    "2. **Escalate** — propose a new vetted checker kind (real code review), then re-run synth.\n\n" +
    "Until one of those happens, the trap remains UN-ENFORCED. Do not edit the\n" +
    "candidate rule below in place — change the source Finding (finding.json) and\n" +
    "re-run synth so provenance stays intact.\n\n" +
    "## Candidate rule (rendered from the Finding for reference only)\n\n" +
    "```yaml\n";
  const ruleCandidate = stringify({
    id: f.id,
    severity: f.severity,
    title: f.title,
    component: f.component,
    detect: f.detect,
    check: f.binding.check,
    test: f.binding.test,
  });
  writeFileSync(
    join(dir, "sketch.md"),
    sketchHeader + ruleCandidate + "```\n",
    "utf8",
  );
  return dir;
}
