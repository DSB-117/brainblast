# Plan: A Solana coding harness, built on existing primitives

**Status:** draft, for review. Not yet executed.
**Relationship to PLAN-solana-deep-dive.md:** this supersedes it. The deep-dive plan made brainblast a better *catcher*; this plan makes the harness a thing the bug *can't escape from in the first place*.

## 1. What we're actually building (and not building)

A real Solana coding harness, designed from first principles, is a **simulation environment with an editor stapled onto it**, not the other way around. Its loyalty is to two things: an **intent artifact** (what the human meant) and an **irreversibility boundary** (what crosses to mainnet). The AI is one agent inside that environment, judged by both, not the master of either.

The good news: the heavy infrastructure pieces of this shape *already exist*, open-source, actively maintained, several backed by the Solana Foundation. We are not building a validator, an IDL compiler, a fuzzer, or a test framework. We are composing them — and building the four things nobody has built yet.

### Primitives we adopt (the foundations)

| Piece | What it gives us | License / org |
|---|---|---|
| **[Surfpool](https://github.com/txtx/surfpool)** | Drop-in `solana-test-validator` replacement with on-demand mainnet account + program forking. This is Ring 3 (continuous simulation against forked state) almost wholesale. Already has "Surfpool Studio" UI for inspecting txs/accounts. | Solana Foundation org (txtx upstream) |
| **[solana-bankrun / LiteSVM](https://github.com/kevinheavey/solana-bankrun)** | Superfast in-process test substrate with time-jumping (`set_clock`), arbitrary account data, mainnet-pulled programs. Surfpool is built on this. We use it for adversarial-axis simulation (what if the blockhash is about to expire? what if congestion spikes?). | MIT, community |
| **[Codama](https://github.com/codama-idl/codama)** | IDL → TS + Rust clients from one source. Solves "two languages, one program" drift directly. Used by the official Solana docs path. | MIT |
| **[Trident](https://github.com/Ackee-Blockchain/trident)** | Open-source Anchor fuzzer (honggfuzz-backed) from Ackee Blockchain, Solana Foundation grant. This is the Rust-side adversarial harness. Property-based and stateful fuzzing built in. | Apache-2.0, Ackee |
| **[Mucho](https://github.com/solana-developers/mucho)** | Solana Foundation's developer CLI — covers scaffolding, build, test, deploy. Worth treating as the CLI shape we extend, not replace. | Solana Foundation |
| **brainblast `packages/core` (us)** | The static auditor / rule engine / RED→GREEN proof loop. Becomes the "intent oracle" runner inside the harness. | MIT |

### What we actually build (the four missing pieces)

These are what *don't* exist today, and what therefore are the entire scope of this project:

1. **The intent artifact + oracle runner.** A declarative description of what the integration *must* satisfy, executable against live simulation state. ("Supply is fixed" isn't a sentence; it's a check.)
2. **The IDE surface.** The transaction graph, cost/rent panel, CPI trust-score panel, intent-oracle status — surfaced *inside the editor the dev already uses*, not a new editor. (VSCode extension for v1. Avoid the multi-month tax of forking an editor.)
3. **The deploy-attestation ceremony.** A signed, committed artifact that is the *only* way to cross to mainnet. The harness itself cannot sign a mainnet transaction; only a separate, minimal, audited tool can, and only against a valid attestation.
4. **Typed keypair lifecycle.** Dev / test / deploy / upgrade-authority keys as first-class typed objects with separate ceremonies, such that `Keypair.generate()` cannot leak into a deploy path even by accident.

Everything else is wiring.

## 2. Architecture in one diagram

```
        ┌─────────────────────────────────────────────────────────────┐
        │                    VSCode (host editor)                     │
        │  ┌─────────────────────────────────────────────────────┐    │
        │  │           Harness extension (we build this)         │    │
        │  │  Transaction graph │ Cost/rent panel │ Trust panel  │    │
        │  │  Intent-oracle status │ Adversarial sim controls    │    │
        │  └─────────────────────────────────────────────────────┘    │
        └─────────────────┬───────────────────────────────────────────┘
                          │ (LSP-shaped JSON, or direct CLI)
                          ▼
        ┌─────────────────────────────────────────────────────────────┐
        │            harness-core (Rust + TS, we build this)          │
        │  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐   │
        │  │ Intent oracle│  │ Trust-graph   │  │ Cost / rent     │   │
        │  │ runner       │  │ resolver      │  │ accountant      │   │
        │  └──────┬───────┘  └───────┬───────┘  └────────┬────────┘   │
        │         │                  │                   │            │
        │  ┌──────▼──────────────────▼───────────────────▼─────────┐  │
        │  │   brainblast/core auditor (the engine we already have)│  │
        │  └───────────────────────────────────────────────────────┘  │
        └──┬────────────────┬──────────────────┬─────────────────┬───┘
           │                │                  │                 │
       ┌───▼────┐    ┌──────▼─────┐     ┌──────▼─────┐    ┌──────▼────┐
       │Surfpool│    │   Codama   │     │  Trident   │    │   Mucho   │
       │ (sim)  │    │ (codegen)  │     │  (fuzzer)  │    │   (CLI)   │
       └────────┘    └────────────┘     └────────────┘    └───────────┘
                                                                 │
                          ┌──────────────────────────────────────┘
                          ▼
                ┌──────────────────────┐         ┌───────────────────┐
                │  Attestation builder │ ──────▶ │  Sign-and-deploy  │
                │  (we build this)     │ signed  │  (minimal, audited│
                │                      │  attest │  separate binary) │
                └──────────────────────┘         └───────────────────┘
                                                  ▲
                                                  │ deploy-authority key
                                                  │ (typed, gated)
```

The dotted boundary between `harness-core` and `Sign-and-deploy` is the irreversibility wall. **The harness, the AI agent, the editor, and the extension cannot cross it.** Only the deploy tool can — and only with a valid attestation.

## 3. Phased plan

### Phase 0 — Compose the primitives (no harness UI yet)
*Goal: prove the foundation pieces talk to each other in a single repo template.*

- Scaffold a sample Anchor project using `mucho` that:
  - Has its IDL as the source of truth, with both TS and Rust clients generated by Codama (no hand-written client code allowed; CI rejects drift).
  - Runs locally on Surfpool with mainnet-fork enabled.
  - Has a Trident fuzzing harness wired up out of the box.
  - Runs brainblast's auditor as a CI step against the generated TS client and the program source.
- **Done when:** the sample repo `git clone && mucho install && mucho test` runs *all* of: Codama codegen, Surfpool sim with forked mainnet, Trident fuzz pass, brainblast audit pass — and a deliberate trap in the sample (Bags-shaped or Token-2022 program-ID-shaped) fails the audit step.
- *This is also the answer to "how would a Solana dev adopt this?"* — they don't adopt a harness; they adopt a project template.

### Phase 1 — The intent artifact and the oracle runner
*Goal: make the PRD executable.*

- Design the intent DSL. Likely YAML, possibly TS, schema-validated. Each intent statement binds to either:
  - a checker kind (so it runs through brainblast's existing engine, statically), or
  - a simulation oracle (a transaction or sequence of transactions whose post-state must satisfy an assertion against Surfpool).
- Build the oracle runner: given an intent file and a Surfpool instance, replays the intents as live simulations and reports pass/fail per intent with the same RED→GREEN discipline we already use.
- **Done when:** the sample project ships with an `intent.yaml` declaring "supply is fixed; creator earns fees; metadata is updatable for 7 days then immutable" — and *each one* is enforced both statically (via brainblast) and dynamically (via a Surfpool oracle), with both reports landing in `report.json`.

### Phase 2 — The VSCode extension shell (the IDE surface)
*Goal: surface the harness in the editor the dev already uses, not a new one.*

- VSCode extension, three panels:
  1. **Transaction graph.** As the dev edits, parse out the transactions the code constructs and render them as a graph. Each node shows: compute units, rent locked, priority fee, signers required, CPI'd programs.
  2. **Trust panel.** For every CPI'd program in the current file, live readout: upgrade authority (and whether it's a multisig), verified-build status, last upgrade, audit status. Updated against mainnet via Surfpool's RPC layer.
  3. **Intent status.** Pass/fail for each declared intent, with a one-click "show me the trace" that opens the failing simulation.
- Inline decorations:
  - Lines that construct mainnet-irreversible state get a red gutter mark.
  - Hardcoded program IDs get the trust-panel summary as a hover tooltip.
  - Functions whose execution path could exceed a CU budget under congestion stress get a warning lens.
- **Done when:** opening the sample project from Phase 0 in VSCode shows all three panels populated, and editing a known trap (e.g., changing `TOKEN_2022_PROGRAM_ID` to `TOKEN_PROGRAM_ID` against a Token-2022 mint) updates the intent panel red within seconds.

### Phase 3 — The adversarial sandbox
*Goal: code only earns the right to leave the sandbox by surviving worst-case mocks.*

- Build the *client-side* adversarial wrapper around Surfpool:
  - Blockhash returns stale 50% of the time (configurable).
  - `getAccountInfo` returns `null` for accounts that exist (race-condition simulation).
  - CPI'd programs return the worst legal value (e.g., zero-share fee config, frozen account).
  - Compute prices spike 100x mid-run.
- Wire Trident in for the Rust-side fuzzing pass.
- Add a "release-mode" gate: code is marked release-mode-eligible only if it has passed against the adversarial wrapper *and* Trident.
- **Done when:** the sample project's tests run twice — once against vanilla Surfpool, once against the adversarial wrapper — and any client code that doesn't handle stale blockhashes / null accounts / worst-case CPI responses fails the second pass with a precise reason.

### Phase 4 — Typed keypairs and the deploy attestation ceremony
*Goal: make the irreversibility boundary real, signed, and committed.*

- Define a `Keypair` type system (TS-side and Rust-side) with four distinct subtypes: `DevKey`, `TestKey`, `DeployKey`, `UpgradeAuthorityKey`. Each has its own loader and its own storage convention (devs are filesystem; deploy/upgrade are explicitly never on disk in plaintext).
- The harness's transaction builder is generic over keypair type, but **mainnet RPC endpoints refuse anything signed by `DevKey` or `TestKey`** at the wrapper layer — a hard refusal, not a warning.
- Build the attestation artifact format: a signed JSON containing the intent oracle results, the trust graph at deploy time, the cost itemization, the bytecode hash of every program being deployed, and the hash of the source tree it was built from. Committed to the repo as `deploys/<timestamp>.attestation.json`.
- Build the minimal `sign-and-deploy` binary: a separate, audited, tiny tool whose only job is "verify an attestation is valid and current, then sign one (1) deploy transaction with the supplied `DeployKey`, then exit." The harness cannot do this; only this tool can.
- **Done when:** the sample project's deploy flow is `harness attest` → `harness validate-attestation` → `sign-and-deploy attestation.json` → tx lands on devnet, and the harness *cannot* be coerced into signing a mainnet tx through any path including a malicious AI prompt injection.

### Phase 5 — Memory as a compounding asset
*Goal: each project's harness work benefits every subsequent project.*

- Program-keyed trust-graph cache: keyed by program ID (not `name@version` — programs don't have semver, their identity *is* their address). One project researching `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` once pre-populates every future run.
- Intent-DSL pattern library: common intents ("token supply is fixed", "creator earns fees", "metadata becomes immutable after window") shipped as importable patterns, so the second project building a Bags-shaped launch doesn't re-derive the intent file from scratch.
- Vetted checker-kind library: closes the loop on the proof-as-classifier story from the deep-dive plan — except now the checkers ride inside the harness, not just `npx brainblast`.
- **Done when:** scaffolding a new project from the harness offers "I'm building a token launch with a fee-share creator → import the supply-is-fixed + creator-earns-fees + revoke-mint-authority intent bundle" and pre-populates the IDL + intent file + suggested CPI trust assertions.

## 4. The decisions to make explicitly (don't drift)

1. **VSCode extension v1, not a forked editor.** Tempting to fork Zed or build a Tauri shell for the "real" experience. Don't. The two-month editor tax buys nothing the dev wants; Solana devs already live in VSCode (or Cursor, which is a VSCode fork — same extension surface). Ship the extension first, evaluate a custom editor only if there's something panels can't express.
2. **Rust + TS shared core, or two separate cores?** Codama's IDL approach pushes us toward a shared schema layer with bindings on both sides; the intent oracle runner can be TS-first (Surfpool already runs as a process; we talk to it over RPC). brainblast's auditor stays TS for client analysis and grows a Rust counterpart only if/when we commit to Anchor program-source analysis as its own deliberate phase (the Phase 2.5 fork from the deep-dive plan, now folded back in).
3. **Where does the AI agent live?** Inside the extension, calling out to Claude/Anthropic API directly, or as a separate process the harness orchestrates. v1 answer: as an extension consumer of the host editor's existing AI (Copilot, Cursor, Claude Code), with the harness exposing its intent/trust/cost surface as MCP tools the AI agent reads. This way we don't compete with the editor's AI; we *constrain* it. The agent's loyalty is still to the AI's host; the harness's loyalty is to the intent artifact and the boundary. They negotiate.
4. **Distribution model.** Open-source the harness extension and core. Charge for the hosted intent-pattern library / cross-project memory layer at Rung 5 scale (Phase 5+). The local thing has to be free or it doesn't get adopted; the network effect is where the business is.
5. **What happens to the existing `npx brainblast` CLI?** It stays, as the *headless CI surface* of the harness. The harness extension is the dev-time experience; the CLI is what gates the merge. Same engine, same rules, same report.json — different surfaces. Honors the "two entry points, one product" framing we already shipped.

## 5. Scope honesty

This is a 6–12 month project minimum to get to Phase 4 (the deploy attestation ceremony) at production quality, with a small team. Phase 0 and Phase 1 are 4–8 weeks of focused work each — fast, because we're composing, not building from scratch. Phase 2 (the VSCode extension) is the longest single phase, because IDE UX is genuinely hard and a bad extension is worse than no extension. Phase 3 and 4 are dense but well-scoped; Phase 5 is open-ended (it *is* the long tail).

The right way to ship this is incrementally and honestly: Phase 0 alone is already a useful, distributable Solana project template, with no harness UI at all. Phase 1 adds the intent file and is the first "ohh I see what this is" moment for users. Phase 2 is the first thing you can demo as a screen recording. Phases 3–5 are the moat.

## 6. What this means for brainblast as it exists today

- The `npx brainblast` CLI continues to ship. It's now the headless face of a larger thing.
- The research skill (`/brainblast`) continues to ship. It becomes the natural way to *seed an intent file* in a new project — the bridge between "describe what you want" and "the harness has an intent.yaml it can enforce."
- The deep-dive plan's *findings* (the five Solana traps) become Phase 0 / Phase 1 acceptance content — they are exactly the traps the sample project must catch to prove the foundation works.
- "Brainblast" may end up being the name of the engine rather than the product. The product needs a name that says what it actually is: *the harness*. Worth a separate conversation, after Phase 0 exists and we know what we're naming.
