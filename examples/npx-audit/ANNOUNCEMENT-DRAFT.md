# Announcement drafts — brainblast v0.2.0

Hero demo for all three: the **Bags zero-fee trap** — an AI agent ships a syntactically-valid
Solana fee-share config that earns its own user 0% of trading fees, *forever*, with no way to fix
it post-launch. brainblast predicts it before the code exists, and now enforces it never regresses.
Live, runnable proof: [`examples/npx-audit/`](README.md).

---

## Show HN

**Title:** Show HN: Brainblast – catch the AI-agent integration trap that earns you $0 forever

Most "AI + docs" tools retrieve current documentation and stop. Retrieval doesn't prevent anything
— an agent can read the right page and still ship the wrong shape.

Brainblast is two things that share one report:

1. **Predict** (a research skill) — before your agent writes a line of integration code, it browses
   live docs for every external API/SDK in your spec and produces a report of facts, severity-rated
   risks, and the decisions that are immutable after deploy.
2. **Enforce** (`npx brainblast .`) — a deterministic, offline static scanner (no LLM, no network)
   that audits the code your agent actually wrote against those same traps, gates CI on a CRITICAL,
   and can generate a durable test that fails forever if the trap regresses.

The example that made me build this: ask an agent to "launch a token via the Bags API and earn
creator fees," and it will very plausibly write a fee-share config that compiles, sums its BPS to
10,000, and launches successfully — while never including *your own wallet* in the recipient list.
The launch succeeds. You earn 0%. Forever. The config is immutable on-chain.

`npx brainblast .` catches that exact shape in under a second, no setup:

```
$ npx brainblast .
  [FAIL ] bags-fee-share-creator-included  src/feeconfig.ts:8
          The creator wallet is not in feeClaimers...
  verdict: blocked  (fail=1, cant_tell=0)
```

Runnable repro: https://github.com/DSB-117/brainblast/tree/main/examples/npx-audit

It also ships built-in checks for a forged-Stripe-webhook bypass (verifying a parsed body instead
of the raw one) and a Privy/JWT auth bypass (decoding a token without verifying its signature,
`aud`, and `iss`).

Published to npm with SLSA provenance attestation (you can verify the build came from CI, not a
laptop): https://www.npmjs.com/package/brainblast

Repo + the research skill: https://github.com/DSB-117/brainblast

Would love feedback — especially on what other "compiles fine, ships a silent catastrophe" traps
people have hit with AI-written integration code. That's the whole roadmap.

---

## X / Twitter thread

**1/**
An AI agent can read the Bags API docs, write a fee-share config that compiles and launches a
token successfully... and pay its own creator $0 in fees. Forever. No way to fix it after launch.

I built brainblast to catch exactly this class of bug — before *and* after the code is written. 🧵

**2/**
Brainblast is one product, two moments:

🔮 Predict — a research skill that reads your spec, browses live docs, and reports the silent
failure modes (zero-revenue configs, auth bypasses, immutable-after-deploy choices) before your
agent writes a line of code.

🛡️ Enforce — `npx brainblast .`: a static, offline scanner that audits what got written against
those same traps and gates your CI on a CRITICAL.

**3/**
Here's the catch in 2 seconds, zero setup:

```
$ npx brainblast .
  [FAIL ] bags-fee-share-creator-included  src/feeconfig.ts:8
          The creator wallet is not in feeClaimers...
  verdict: blocked
```

Runnable repro → [link to examples/npx-audit]

**4/**
It also ships checks for:
- Stripe webhooks verified on a parsed (not raw) body → forged events accepted
- Privy/JWT tokens decoded but never signature-verified → full auth bypass

All offline. No LLM calls during the scan — deterministic, so it's safe to gate a build on.

**5/**
Published to npm with SLSA provenance — you can cryptographically verify the package came from
this repo's CI, not someone's laptop.

npm: [link] · repo: [link] · the research skill that predicted this trap in the first place: [link
to examples/bags-api]

**6/**
Building this in the open along a Predict → Enforce → Watch → Compound roadmap — next up is
generated guardrail tests that make a fixed trap *impossible* to silently regress. Feedback (and
"here's a trap I hit" stories) very welcome. [link to ROADMAP.md]

---

## r/solana

**Title:** Built a tool that catches the "your AI agent just launched a token where YOU earn 0%
forever" bug before you ship it

If you've had an agent (or a tired version of yourself) wire up the Bags Token Launch v2 fee-share
config, you've probably seen how easy it is to build something that *looks* right — BPS sum to
10,000, the call compiles, the launch succeeds — while quietly leaving the creator's own wallet out
of `feeClaimers`. The token launches fine. You just... don't get paid. Ever. The config's immutable
on-chain, so there's no patch, no migration, nothing — you relaunch from scratch.

I built [brainblast](https://github.com/DSB-117/brainblast) to catch this specific class of trap —
silent, permanent, zero-revenue misconfigurations that "compile clean" — both before you write the
integration (a research skill that reads the live Bags docs and flags exactly this in the report)
and after (a static scanner you run with `npx brainblast .` that audits the actual code and blocks
your CI on it).

Zero-setup repro of the catch:

```
$ npx brainblast .
  [FAIL ] bags-fee-share-creator-included  src/feeconfig.ts:8
          The creator wallet is not in feeClaimers. ... they earn zero fees forever, and the
          fee config is immutable on-chain after launch.
  verdict: blocked
```

→ https://github.com/DSB-117/brainblast/tree/main/examples/npx-audit

Repo + the full research run that first found this trap (with the exact docs quotes and BPS math):
https://github.com/DSB-117/brainblast — the [`examples/bags-api/`](https://github.com/DSB-117/brainblast/tree/main/examples/bags-api)
folder is a complete, real run against the Bags requirements.

Curious whether anyone here has hit this one for real, or has other Solana SDK traps (Jito bundle
ordering, LUT slot waits, immutable fee-mode UUIDs — all things the research run also surfaced)
worth building a check for next.

---

## Notes for whoever posts these

- **Order:** Show HN first (it sets the canonical framing other posts can link back to), then the
  X thread same day, then r/solana — Solana audiences respond better to "here's a real trap I hit"
  than "here's a tool," so lead the Reddit post with the bug, not the product.
- **Replace bracketed `[link]` placeholders** with the actual npm/repo/example URLs before posting.
- **Show HN timing:** post on a US-morning weekday for visibility; be ready to answer "why not just
  ask the agent to read the docs more carefully" — the answer is in the README's framing
  (retrieval ≠ enforcement) and is worth having ready verbatim.
- **Do not overstate "no LLM"** — the *audit* (the CLI) is deterministic and offline; the *research*
  (the skill) does browse live docs via a host agent. Keep that distinction precise across all three
  posts; it's the kind of nuance a skeptical HN/Reddit audience will catch and discount you for if
  you blur it.
