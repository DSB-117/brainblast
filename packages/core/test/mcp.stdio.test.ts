import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Regression: `brainblast mcp` called process.exit(0) immediately after
// server.connect(transport) resolved. The MCP SDK's StdioServerTransport
// connect()/start() resolves as soon as its stdin listener is attached, NOT
// when the client disconnects — so the server exited before it could ever
// handle a request, breaking the entire MCP integration for any real client
// (Claude Code, Cursor, ...) that spawns the process and expects a live
// stdio connection. Fixed by blocking forever (same idiom as `watch`)
// instead of exiting. A naive fix (just deleting process.exit) surfaced a
// SECOND bug: cli.ts's top-level script fell through into the default audit
// path below, printing plain-text audit output onto the same stdout stream
// as the JSON-RPC protocol — fatal for any MCP client's line-based JSON
// parser. This test guards both: the server responds, and stdout carries
// ONLY valid JSON-RPC lines.
const here = dirname(fileURLToPath(import.meta.url));
const cliSrc = resolve(here, "..", "src", "cli.ts");
const repoRoot = resolve(here, "..", "..", "..");

describe("brainblast mcp (stdio transport)", () => {
  let proc: ChildProcessWithoutNullStreams | undefined;

  afterEach(() => {
    proc?.kill("SIGTERM");
    proc = undefined;
  });

  it("stays alive and returns a clean tools/list response with no stray stdout", async () => {
    proc = spawn("npx", ["tsx", cliSrc, "mcp"], { cwd: repoRoot });

    let stdout = "";
    const stderrChunks: string[] = [];
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => stderrChunks.push(d.toString()));

    const exited = new Promise<number | null>((res) => proc!.on("exit", res));

    // Written immediately: a pipe write before the child's stdin listener
    // attaches just sits in the OS buffer, so this doesn't race the child's
    // startup — and it avoids wasting fixed-delay budget under a loaded CI box.
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\n");

    // Wait for the response line, or the process dying (the pre-fix failure
    // mode). Generous budget: `npx tsx` cold-starts (module resolution +
    // TS transform + MCP SDK load) can take several seconds alone, and far
    // longer under full-suite parallel CPU contention.
    const deadline = Date.now() + 25_000;
    while (!stdout.includes('"jsonrpc"') && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 100));
    }

    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const response = JSON.parse(lines[lines.length - 1]);
    expect(response.id).toBe(1);
    expect(response.result.tools.map((t: any) => t.name)).toContain("brainblast_recall");

    proc.kill("SIGTERM");
    await exited;
  }, 30_000);
});
