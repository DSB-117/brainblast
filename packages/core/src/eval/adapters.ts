// Model adapters — "bring your model."
//
// The harness is model-agnostic: it drives anything that maps a prompt string to
// a code string. Three adapters ship:
//
//   staticAdapter  — a pure function; used by tests and offline demos.
//   commandAdapter — spawn any CLI (prompt on stdin, code on stdout); this is how
//                    you score an agent that isn't an HTTP endpoint.
//   httpAdapter    — OpenAI-compatible /chat/completions OR Anthropic /messages,
//                    keyed from env. Covers most hosted models and gateways.
//
// No new dependencies: child_process for the command adapter, global fetch for
// HTTP. Model output is unwrapped from Markdown code fences so the grader sees
// source, not prose.

import { spawn } from "node:child_process";
import type { ModelAdapter } from "./types.ts";

// Strip a leading/trailing Markdown code fence if the model wrapped its answer.
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const fence = t.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  if (fence) return fence[1];
  // Also handle a single opening fence with no closer.
  if (t.startsWith("```")) return t.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/```$/, "");
  return text;
}

export function staticAdapter(fn: (prompt: string) => string, name = "static"): ModelAdapter {
  return { name, complete: async (prompt) => fn(prompt) };
}

// Spawn `cmd` (via the shell), pipe the prompt to stdin, resolve with stdout.
export function commandAdapter(cmd: string, name = `cmd:${cmd.split(" ")[0]}`): ModelAdapter {
  return {
    name,
    complete: (prompt) =>
      new Promise((resolve, reject) => {
        const child = spawn(cmd, { shell: true });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d.toString()));
        child.stderr.on("data", (d) => (err += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) return reject(new Error(`model command exited ${code}: ${err.slice(0, 500)}`));
          resolve(stripCodeFence(out));
        });
        child.stdin.write(prompt);
        child.stdin.end();
      }),
  };
}

export interface HttpAdapterOpts {
  /** "openai" (Chat Completions) or "anthropic" (Messages). */
  api: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  system?: string;
  fetchImpl?: typeof fetch;
}

// A hosted model over its native HTTP API. OpenAI-compatible endpoints (OpenAI,
// Together, Groq, OpenRouter, vLLM, …) use `api: "openai"`; Claude uses
// `api: "anthropic"`.
export function httpAdapter(opts: HttpAdapterOpts): ModelAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: opts.model,
    complete: async (prompt) => {
      if (opts.api === "anthropic") {
        const res = await doFetch(`${opts.baseUrl.replace(/\/$/, "")}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: 1536,
            ...(opts.system ? { system: opts.system } : {}),
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        const text = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
        return stripCodeFence(text);
      }
      const res = await doFetch(`${opts.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return stripCodeFence(j.choices?.[0]?.message?.content ?? "");
    },
  };
}
