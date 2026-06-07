# brainblast

Deterministic auditor for catastrophic AI-integration bugs. Point it at a repo;
it finds the silent money/auth traps an AI agent ships, and generates the
behavioral test that proves they're fixed. No LLM, no API key, no network — it
parses your code statically and runs offline.

## Use

```sh
npx brainblast .            # scan the repo, write .agent-research/report.json
npx brainblast . --ci       # exit 1 if a confirmed CRITICAL remains
npx brainblast . --ci --strict   # also fail on CANT_TELL (can't statically prove)
```

Exit codes: **0** clean · **1** a confirmed FAIL at/above the threshold · CANT_TELL
is a warning by default (a red build always means a real, confirmed problem).

## What it catches (today, Node/TypeScript)

- **Stripe webhooks** that don't verify the signature on the **raw** body →
  forged `payment_intent.succeeded` events accepted.
- **Privy / JWT** access tokens decoded without verifying the signature, or
  without asserting `aud` + `iss` → auth bypass / cross-app token reuse.

Each finding lands in `report.json` (stable, versioned `schemaVersion: "1.0"`)
with a `checks[]` array a CI gate can read.

## Rules are data

Detection lives in `*.yaml` rules (facts) that bind to a small set of vetted,
human-maintained checker + test templates by `kind` — never executable code in a
rule. Drop project-specific rules in `.agent-research/rules/*.yaml` and the
auditor loads them on top of the bundled pack (they can add traps, not shadow
bundled ones). Invalid rules are rejected at load.

## Library API

```ts
import { audit, resolveRules } from "brainblast";
const { checks, report } = audit(process.cwd(), resolveRules(process.cwd()));
```

## Security model

- **The audit is static.** `brainblast <dir>` parses source with ts-morph and
  never executes it, so auditing untrusted code does not run it. YAML rules are
  data only (no code execution, no prototype pollution).
- **Generated behavioral tests execute the audited repo's code when you run
  them.** That's expected when you audit your own repo. If you run brainblast on
  untrusted code (e.g. a fork PR) and then run the generated tests, run them in a
  sandbox — the same caution as running any untrusted test suite.

## Develop

```sh
npm install
npm test         # unit suite
npm run prove    # end-to-end: generated tests RED on vulnerable, GREEN on fixed
npm run build    # produce dist/ (the published artifact)
```

MIT.
