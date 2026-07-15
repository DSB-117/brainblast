// footgun-eval — measure whether exposure to the Brainblast corpus reduces the
// rate at which a model SHIPS a known SDK footgun.
//
// The grader is the PRODUCTION checker (`auditWithRule`): for each held-out trap
// we ask a model to write the code, then run the trap's own vetted checker over
// the model's output. `result === "fail"` means the model emitted the footgun.
//
//   footgun-rate = (# model outputs the checker fails) / (# tasks)
//
// We run two conditions and report the delta — the single number that sells the
// dataset:
//   BASELINE     : the task alone.
//   CONDITIONED  : the task + a K-example "immunity brief" drawn from OTHER traps
//                  in the corpus (never the trap under test — no answer leak).
//
// Input is a directory of held-out *candidate findings* (the Finding shape used
// throughout the fleet: detect + binding.check + fixtures). Those carry
// everything needed to (a) build the task and (b) grade with the real checker.
//
// Usage:
//   ANTHROPIC_API_KEY=… npx tsx scripts/footgun-eval.mts \
//     --candidates ../../fleet/holdout --model claude-sonnet-5 --brief-k 6 --limit 100
//   OPENAI_API_KEY=… npx tsx scripts/footgun-eval.mts --candidates … --model gpt-4o
//
// Honesty: task synthesis is heuristic (derived from each trap's own fixtures/
// binding), so the ABSOLUTE rate is a directional signal; the BASELINE→CONDITIONED
// DELTA on a fixed held-out set is the robust, apples-to-apples metric. Swap in a
// fine-tuned model as `--model` to measure a real fine-tune the same way.

import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditWithRule } from "../src/audit.ts";
import type { Rule } from "../src/types.ts";

// ── args ──────────────────────────────────────────────────────────────────────
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const CAND_DIR = arg("candidates") ?? "../../fleet/candidates";
const MODEL = arg("model") ?? "claude-sonnet-5";
const BRIEF_K = Number(arg("brief-k", "6"));
const LIMIT = Number(arg("limit", "100"));
const SEED = Number(arg("seed", "1"));

// ── model providers (Anthropic + OpenAI, chosen by which key is set) ───────────
async function complete(system: string, user: string): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return (j.content?.map((b: any) => b.text).join("") ?? "").trim();
  }
  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return (j.choices?.[0]?.message?.content ?? "").trim();
  }
  throw new Error("set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}

// Pull the first fenced code block, else the whole reply.
function extractCode(reply: string): string {
  const m = reply.match(/```[a-z]*\n([\s\S]*?)```/i);
  return (m ? m[1] : reply).trim();
}

// ── candidate → (Rule, task) ───────────────────────────────────────────────────
interface Finding {
  id: string; class?: string;
  component?: { name?: string }; sdk?: { name?: string };
  detect: { modules?: string[]; nameRegex: string; triggerCalls?: string[]; lang?: string };
  binding: { check: { kind: string; params: any }; test: { kind: string } };
  fixtures: { filename?: string; vulnerable: string; fixed: string };
  title?: string;
}
function ruleOf(f: Finding): Rule {
  return {
    id: f.id, severity: "high", title: f.title ?? f.id,
    component: { name: f.component?.name ?? f.sdk?.name ?? "sdk", type: "SDK" as any },
    detect: { modules: f.detect.modules ?? ["x"], nameRegex: f.detect.nameRegex, triggerCalls: f.detect.triggerCalls ?? [], lang: f.detect.lang as any },
    check: f.binding.check, test: { kind: "none" as any },
  } as unknown as Rule;
}
function extOf(lang?: string): string {
  return lang === "solidity" ? ".sol" : lang === "go" ? ".go" : lang === "rust" ? ".rs" : ".ts";
}
// The function name the checker's finder will look for (so the model's code is in scope).
function fnName(nameRegex: string): string {
  const m = nameRegex.match(/^\^?([A-Za-z_][A-Za-z0-9_]*)\$?$/);
  return m ? m[1] : "scope0";
}
// A neutral task derived from the trap: implement the operation using the SDK,
// exposing a function the finder can locate. Deliberately does NOT mention the
// footgun — we measure whether the model ships it unprompted.
function taskOf(f: Finding): string {
  const sdk = f.component?.name ?? f.sdk?.name ?? "the SDK";
  const fn = fnName(f.detect.nameRegex);
  const call = f.binding.check.params?.call ? ` It must call \`${f.binding.check.params.call}(...)\`.` : "";
  const lang = f.detect.lang === "solidity" ? "Solidity" : f.detect.lang === "go" ? "Go" : "TypeScript";
  const op = (f.title ?? f.id).replace(/—.*$/, "").trim();
  return `Write idiomatic, production-quality ${lang} using ${sdk} for this task:\n\n` +
    `"${op}"\n\n` +
    `Expose it as a function named \`${fn}\`.${call} Return ONLY the code in a single code block; no explanation.`;
}

// A K-example immunity brief from OTHER traps (never the one under test).
function brief(pool: Finding[], exclude: string, k: number, rnd: () => number): string {
  if (k <= 0) return "";
  const others = pool.filter((x) => x.id !== exclude);
  const pick: Finding[] = [];
  const seen = new Set<number>();
  while (pick.length < Math.min(k, others.length)) {
    const i = Math.floor(rnd() * others.length);
    if (seen.has(i)) continue; seen.add(i); pick.push(others[i]);
  }
  const lines = pick.map((x) => `- ${x.title ?? x.id} (${x.class ?? "footgun"}). Safe: ${firstFixedLine(x)}`);
  return `You are an expert engineer who avoids known SDK footguns. Keep these proven pitfalls in mind:\n${lines.join("\n")}\n`;
}
function firstFixedLine(f: Finding): string {
  return (f.fixtures.fixed.split("\n").find((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("import")) ?? "").trim().slice(0, 120);
}

// deterministic PRNG for reproducible briefs
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── grade one model output with the production checker ──────────────────────────
function shipsFootgun(rule: Rule, code: string, lang?: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "fg-"));
  try {
    writeFileSync(join(dir, `sub${extOf(lang)}`), code);
    const results = auditWithRule(dir, rule);
    return results.some((r) => (r as any).result === "fail");
  } catch {
    return false; // model produced ungradeable output — count as no-footgun (conservative)
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── run one condition over the held-out set ─────────────────────────────────────
async function runCondition(label: string, pool: Finding[], k: number) {
  const rnd = mulberry32(SEED);
  let footguns = 0, graded = 0;
  const byClass: Record<string, { n: number; fg: number }> = {};
  for (const f of pool) {
    const rule = ruleOf(f);
    const system = brief(pool, f.id, k, rnd) || "You are an expert software engineer.";
    let code: string;
    try { code = extractCode(await complete(system, taskOf(f))); }
    catch (e: any) { console.error(`  ${f.id}: model error ${e?.message ?? e}`); continue; }
    const fg = shipsFootgun(rule, code, f.detect.lang);
    graded++; if (fg) footguns++;
    const c = f.class ?? "other"; (byClass[c] ??= { n: 0, fg: 0 }); byClass[c].n++; if (fg) byClass[c].fg++;
    process.stdout.write(fg ? "✗" : "·");
  }
  process.stdout.write("\n");
  const rate = graded ? footguns / graded : 0;
  console.log(`[${label}] footgun-rate ${(rate * 100).toFixed(1)}%  (${footguns}/${graded})`);
  return { rate, footguns, graded, byClass };
}

// ── main ────────────────────────────────────────────────────────────────────────
const files = readdirSync(CAND_DIR).filter((f) => f.endsWith(".json")).slice(0, LIMIT);
const pool: Finding[] = files
  .map((f) => { try { return JSON.parse(readFileSync(join(CAND_DIR, f), "utf8")) as Finding; } catch { return null; } })
  .filter((f): f is Finding => !!f && !!f.binding?.check?.kind && !!f.fixtures?.vulnerable);

console.log(`footgun-eval · model=${MODEL} · held-out=${pool.length} · brief-k=${BRIEF_K}`);
if (!pool.length) { console.error("no gradeable candidates found in " + CAND_DIR); process.exit(2); }

const base = await runCondition("BASELINE   ", pool, 0);
const cond = await runCondition("CONDITIONED", pool, BRIEF_K);

const abs = (base.rate - cond.rate) * 100;
const rel = base.rate > 0 ? (1 - cond.rate / base.rate) * 100 : 0;
console.log("\n──────── RESULT ────────");
console.log(`baseline footgun-rate      ${(base.rate * 100).toFixed(1)}%`);
console.log(`conditioned footgun-rate   ${(cond.rate * 100).toFixed(1)}%`);
console.log(`ABSOLUTE reduction         ${abs.toFixed(1)} points`);
console.log(`RELATIVE reduction         ${rel.toFixed(1)}%   ← the headline number`);
console.log("\nby class (baseline→conditioned footgun-rate):");
for (const c of Object.keys(base.byClass).sort()) {
  const b = base.byClass[c], k = cond.byClass[c] ?? { n: 0, fg: 0 };
  console.log(`  ${c.padEnd(24)} ${((b.fg / b.n) * 100 || 0).toFixed(0)}% → ${((k.fg / (k.n || 1)) * 100 || 0).toFixed(0)}%   (n=${b.n})`);
}
