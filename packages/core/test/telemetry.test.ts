import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isTelemetryEnabled,
  getUserHash,
  getRepoHash,
  telemetryFilePath,
  recordGraduationEvents,
} from "../src/telemetry.ts";

const ORIGINAL_ENV = process.env.BRAINBLAST_TELEMETRY;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.BRAINBLAST_TELEMETRY;
  else process.env.BRAINBLAST_TELEMETRY = ORIGINAL_ENV;
});

describe("isTelemetryEnabled", () => {
  beforeEach(() => {
    delete process.env.BRAINBLAST_TELEMETRY;
  });

  it("is off by default", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    expect(isTelemetryEnabled(d)).toBe(false);
  });

  it("is enabled via BRAINBLAST_TELEMETRY=1", () => {
    process.env.BRAINBLAST_TELEMETRY = "1";
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    expect(isTelemetryEnabled(d)).toBe(true);
  });

  it("is enabled via .agent-research/config.json", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    mkdirSync(join(d, ".agent-research"), { recursive: true });
    writeFileSync(join(d, ".agent-research", "config.json"), JSON.stringify({ telemetry: true }));
    expect(isTelemetryEnabled(d)).toBe(true);
  });

  it("env var BRAINBLAST_TELEMETRY=0 overrides a config.json opt-in", () => {
    process.env.BRAINBLAST_TELEMETRY = "0";
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    mkdirSync(join(d, ".agent-research"), { recursive: true });
    writeFileSync(join(d, ".agent-research", "config.json"), JSON.stringify({ telemetry: true }));
    expect(isTelemetryEnabled(d)).toBe(false);
  });

  it("treats a malformed config.json as disabled", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    mkdirSync(join(d, ".agent-research"), { recursive: true });
    writeFileSync(join(d, ".agent-research", "config.json"), "not json");
    expect(isTelemetryEnabled(d)).toBe(false);
  });
});

describe("getUserHash / getRepoHash", () => {
  it("returns a stable 16-char hex hash for the same machine", () => {
    const a = getUserHash();
    const b = getUserHash();
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns a stable 16-char hex hash per repo dir", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-repo-"));
    const a = getRepoHash(d);
    const b = getRepoHash(d);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns different hashes for different repo dirs", () => {
    const d1 = mkdtempSync(join(tmpdir(), "bb-repo-"));
    const d2 = mkdtempSync(join(tmpdir(), "bb-repo-"));
    expect(getRepoHash(d1)).not.toBe(getRepoHash(d2));
  });
});

describe("recordGraduationEvents", () => {
  it("does nothing when there are no events", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    recordGraduationEvents(d, []);
    expect(existsSync(telemetryFilePath(d))).toBe(false);
  });

  it("appends NDJSON events with repo/user hashes and a timestamp", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    recordGraduationEvents(d, [{ pack_id: "acme-pack", rule_id: "acme-custom-trap" }]);

    const file = telemetryFilePath(d);
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]);
    expect(event.pack_id).toBe("acme-pack");
    expect(event.rule_id).toBe("acme-custom-trap");
    expect(event.repo_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(event.user_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(() => new Date(event.timestamp).toISOString()).not.toThrow();
  });

  it("appends additional events on subsequent calls", () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    recordGraduationEvents(d, [{ pack_id: "acme-pack", rule_id: "rule-a" }]);
    recordGraduationEvents(d, [{ pack_id: "acme-pack", rule_id: "rule-b" }]);

    const lines = readFileSync(telemetryFilePath(d), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).rule_id).toBe("rule-a");
    expect(JSON.parse(lines[1]).rule_id).toBe("rule-b");
  });
});
