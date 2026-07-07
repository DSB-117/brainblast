// Local RED→GREEN prover — same path reprove uses, for pre-submit validation.
// Usage: tsx scripts/prove-one.ts <substr> [<substr> ...]
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proveFinding } from "../src/synth/index.ts";

const CANDIR = join(import.meta.dirname, "..", "..", "..", "fleet", "candidates");
const subs = process.argv.slice(2);
const files = readdirSync(CANDIR).filter((f) => f.endsWith(".json") && (!subs.length || subs.some((s) => f.includes(s))));
const stageRoot = mkdtempSync(join(tmpdir(), "bb-prove-"));
let proven = 0, draft = 0;
try {
  for (const f of files) {
    const finding = JSON.parse(readFileSync(join(CANDIR, f), "utf8"));
    let v: any;
    try { v = await proveFinding(finding, stageRoot, "ingest"); }
    catch (e: any) { console.log(`✗ ${f}: threw — ${e?.message ?? e}`); draft++; continue; }
    const ok = v.verdict === "PROVEN";
    ok ? proven++ : draft++;
    console.log(`${ok ? "✓" : "✗"} ${f}: ${v.verdict} via ${v.method ?? "-"}${ok ? "" : " — " + (v.reason ?? "")}`);
  }
} finally { rmSync(stageRoot, { recursive: true, force: true }); }
console.log(`\nPROVEN ${proven} / DRAFT ${draft} (of ${files.length})`);
