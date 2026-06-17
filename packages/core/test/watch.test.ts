import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIncrementalScan, type WatchEvent } from "../src/watch.ts";
import { resolveRules } from "../src/resolveRules.ts";

function git(dir: string, args: string[]) {
  execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

describe("runIncrementalScan", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "brainblast-watch-"));
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);

    writeFileSync(join(dir, "ok.ts"), "export function ok(x: number) {\n  return x + 1;\n}\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "initial"]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits only scan_complete (0 changes) on a clean tree", () => {
    const events: WatchEvent[] = [];
    runIncrementalScan(dir, resolveRules(dir), (e) => events.push(e));
    expect(events).toEqual([{ type: "scan_complete", filesChanged: 0, findings: 0, durationMs: expect.any(Number) }]);
  });

  it("emits a finding event for a newly-saved vulnerable webhook handler", () => {
    writeFileSync(
      join(dir, "webhook.ts"),
      `import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_x");
export function handleStripeWebhook(rawBody: string, _signature: string) {
  const event = JSON.parse(rawBody);
  return { received: true, type: event.type };
}
`,
    );

    const events: WatchEvent[] = [];
    runIncrementalScan(dir, resolveRules(dir), (e) => events.push(e));

    const finding = events.find((e) => e.type === "finding");
    expect(finding).toBeDefined();
    expect(finding).toMatchObject({ ruleId: "stripe-webhook-raw-body-verification", result: "fail" });

    const complete = events.find((e) => e.type === "scan_complete");
    expect(complete).toMatchObject({ filesChanged: 1, findings: 1 });

    rmSync(join(dir, "webhook.ts"));
  });

  it("emits scan_error when not a git work tree", () => {
    const plainDir = mkdtempSync(join(tmpdir(), "brainblast-notgit-"));
    try {
      const events: WatchEvent[] = [];
      runIncrementalScan(plainDir, resolveRules(plainDir), (e) => events.push(e));
      expect(events).toEqual([{ type: "scan_error", message: expect.any(String) }]);
    } finally {
      rmSync(plainDir, { recursive: true, force: true });
    }
  });
});
