import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isTelemetryEnabled,
  getUserHash,
  getRepoHash,
  telemetryFilePath,
  recordGraduationEvents,
  submitTelemetry,
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

describe("submitTelemetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op when telemetry.ndjson doesn't exist", async () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitTelemetry(d, "https://registry.example");
    expect(result).toEqual({ submitted: 0, accepted: 0, rejected: 0, graduations: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs recorded events to <registryUrl>/api/telemetry", async () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    recordGraduationEvents(d, [{ pack_id: "acme-pack", rule_id: "acme-custom-trap" }]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accepted: 1,
        rejected: 0,
        graduations: [{ pack_id: "acme-pack", rule_id: "acme-custom-trap", distinct_pairs: 1, graduated: false }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitTelemetry(d, "https://registry.example");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://registry.example/api/telemetry");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].pack_id).toBe("acme-pack");

    expect(result.submitted).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.graduations[0].rule_id).toBe("acme-custom-trap");
  });

  it("throws when the registry responds with an error", async () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    recordGraduationEvents(d, [{ pack_id: "acme-pack", rule_id: "rule-a" }]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitTelemetry(d, "https://registry.example")).rejects.toThrow(/500/);
  });

  it("defaults to BRAINBLAST_REGISTRY_URL or DEFAULT_REGISTRY_URL", async () => {
    const d = mkdtempSync(join(tmpdir(), "bb-tel-"));
    recordGraduationEvents(d, [{ pack_id: "acme-pack", rule_id: "rule-a" }]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: 1, rejected: 0, graduations: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await submitTelemetry(d);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://registry.brainblast.tech/api/telemetry");
  });
});
