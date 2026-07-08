import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  crossRepoPrecedent,
  loadExperience,
  personallyFixedRules,
  recordFixEvents,
  type ExperienceEvent,
} from "../src/hive/experience.ts";
import { hivePaths } from "../src/hive/store.ts";
import { assembleBrief, renderBriefText } from "../src/hive/brief.ts";
import type { CorpusVti } from "../src/corpus.ts";

const FIX = {
  ruleId: "stripe-webhook-raw-body",
  file: "src/webhook.ts",
  exportName: "handleWebhook",
  fixedAt: "2026-06-15",
  detail: "raw body was not used for signature verification",
};

describe("hive experience log", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hive-exp-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records fix events idempotently, repo-relativizing absolute paths", () => {
    const repo = { path: "/work/app-a", name: "app-a" };
    const first = recordFixEvents(root, repo, [{ ...FIX, file: "/work/app-a/src/webhook.ts" }]);
    expect(first).toMatchObject({ added: 1, total: 1 });
    const again = recordFixEvents(root, repo, [{ ...FIX, file: "/work/app-a/src/webhook.ts" }]);
    expect(again).toMatchObject({ added: 0, total: 1 });

    const events = loadExperience(root);
    expect(events[0]).toMatchObject({ ruleId: FIX.ruleId, repoName: "app-a", file: "src/webhook.ts" });
  });

  it("tolerates a corrupt line and keeps reading", () => {
    recordFixEvents(root, { path: "/a", name: "a" }, [FIX]);
    appendFileSync(hivePaths(root).experienceLog, "{broken\n");
    recordFixEvents(root, { path: "/b", name: "b" }, [{ ...FIX, fixedAt: "2026-07-01" }]);
    expect(loadExperience(root)).toHaveLength(2);
  });

  it("crossRepoPrecedent cites the most recent fix from a DIFFERENT repo only", () => {
    recordFixEvents(root, { path: "/work/app-a", name: "app-a" }, [FIX]);
    recordFixEvents(root, { path: "/work/app-b", name: "app-b" }, [{ ...FIX, fixedAt: "2026-07-01" }]);
    const events = loadExperience(root);

    const p = crossRepoPrecedent(events, FIX.ruleId, "/work/app-c");
    expect(p).toMatchObject({ fixedAt: "2026-07-01", exportName: "handleWebhook" });
    expect(p!.file).toContain("app-b");

    // From app-b itself, only app-a's older fix qualifies.
    expect(crossRepoPrecedent(events, FIX.ruleId, "/work/app-b")!.file).toContain("app-a");
    expect(crossRepoPrecedent(events, "unknown-rule", "/work/app-c")).toBeUndefined();
  });

  it("personallyFixedRules keeps the latest event per rule", () => {
    recordFixEvents(root, { path: "/a", name: "a" }, [FIX, { ...FIX, fixedAt: "2026-07-02", file: "other.ts" }]);
    const byRule = personallyFixedRules(loadExperience(root));
    expect(byRule.get(FIX.ruleId)!.fixedAt).toBe("2026-07-02");
  });
});

describe("experience-aware briefs", () => {
  function vti(over: Record<string, unknown> = {}): CorpusVti {
    return {
      trapId: "stripe-webhook-raw-body",
      sdk: { name: "stripe" },
      severity: "high",
      class: "auth-bypass",
      corroborationCount: 0,
      redGreenProof: { red: true, green: true },
      capturedAt: "2026-06-01T00:00:00.000Z",
      ...over,
    } as CorpusVti;
  }

  const experience: ExperienceEvent[] = [
    {
      ruleId: "stripe-webhook-raw-body",
      repoPath: "/work/app-a",
      repoName: "app-a",
      file: "src/webhook.ts",
      exportName: "handleWebhook",
      fixedAt: "2026-06-15",
      detail: "raw body",
    },
  ];

  it("a personally-fixed trap outranks a higher-scored stranger and is flagged", () => {
    const brief = assembleBrief({
      deps: { stripe: "^17.0.0" },
      vtis: [
        vti({ trapId: "stripe-connect-zero-application-fee", severity: "critical", corroborationCount: 9 }),
        vti(), // lower score, but personally fixed
      ],
      experience,
    });
    expect(brief.entries[0].trapId).toBe("stripe-webhook-raw-body");
    expect(brief.entries[0].personallyFixed).toMatchObject({ repoName: "app-a" });
    expect(renderBriefText(brief)).toContain("you fixed this exact trap in app-a");
  });

  it("without experience the ranking is score-driven and unflagged", () => {
    const brief = assembleBrief({
      deps: { stripe: "^17.0.0" },
      vtis: [vti({ trapId: "hot", severity: "critical", corroborationCount: 9 }), vti()],
    });
    expect(brief.entries[0].trapId).toBe("hot");
    expect(brief.entries[0].personallyFixed).toBeUndefined();
  });
});
