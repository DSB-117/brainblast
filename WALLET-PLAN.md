# The Agent Wallet — plan

**Status:** P0–P3 landed (engineering) · additive, default-off · audit path unchanged
**Companion to:** [`ROADMAP-TRAINING-DATA.md`](ROADMAP-TRAINING-DATA.md) (this is the
on-chain `$BRAIN` substrate its Stages 2 & 4 were deferred onto)

> **Legend:** ✅ shipped · ◐ in progress · ☐ not started.

---

## Why this exists

For an AI agent to participate in the `$BRAIN` data economy — stake the
anti-poisoning bond on a contributed VTI, earn dividends when that data sells,
pay for feed access — it needs to hold and move `$BRAIN`/`$USDC`/`$SOL`. Today
that means a human hand-sets `AGENT_OPS_WALLET_SECRET` for
[`scripts/agent-stake`](scripts/agent-stake/stake.ts). That's friction, and it
puts a raw secret in the environment. The Agent Wallet makes the wallet a
first-class, recoverable, policy-governed primitive the agent can generate and
operate itself — with the human retaining recovery, caps, and a sweep button.

## The one rule everything hangs on

Brainblast's brand is *protect irreplaceable Solana secrets from AI agents*. An
agent-operated hot wallet only reconciles with that on one condition, which is
the spine of this design:

> The Agent Wallet is a **small, capped, sacrificial ops wallet — never the
> user's principal.** The human always keeps (a) recovery, (b) caps, (c)
> revocation/sweep. Worst case under prompt-injection or key leak is the
> *capped balance at that moment*, never the owner's holdings.

The **caps + recipient allowlist — not the at-rest encryption — are what bound a
compromised agent.** We say that plainly; the encryption defends the backup, the
policy defends the funds.

## Built on three existing primitives

| Need | Reused from | How |
|---|---|---|
| Key at rest + recovery | [`keys/vault.ts`](packages/core/src/keys/vault.ts) | The secret is stored **only** in the AES-256-GCM Vault, recoverable by pubkey; a `git clean -fdx` can't reach it |
| Spend governance | [`signguard/policy.ts`](packages/core/src/signguard/policy.ts) | Every outbound tx passes the standing policy: per-tx/session caps, recipient allowlist, `blockUnknownPrograms`, blocked authority/upgrade/delegate |
| Cumulative caps | [`scripts/agent-stake`](scripts/agent-stake/stake.ts) pattern | Session-spend ledger; per-tx + cumulative USD caps, fail-closed |

The agent wallet's stored secret is a `solana-keypair-64` (seed‖pubkey) — the
exact format Keyguard already classifies and the Vault already protects. We
generate it with `node:crypto` (ed25519), so the recovery-critical path adds **no
new dependency**; only network ops (balance/sweep) lazy-import `@solana/web3.js`.

## Custody — tiered (decided)

- **Tier 1 — capped local ops wallet (default, P0–P2).** `wallet init`
  auto-generates, Vault-stores, and surfaces the secret **once** for the owner's
  own backup. Agent signs autonomously within Signguard caps. Shared control =
  owner holds the Vault passphrase + backup, sets caps, can sweep/rotate anytime.
- **Tier 2 — owner-delegated SPL allowance (opt-in, P3).** Owner signs a one-time
  `approve` from their real wallet granting the agent pubkey a capped
  `$BRAIN`/`$USDC` allowance; agent spends as delegate; owner `revoke`s on-chain.
  Agent never custodies principal. Same command surface.
- **Tier 3 — Squads / smart-wallet co-signing.** Future, treasury-scale; design
  doesn't preclude it.

## Spend authority — receive + stake under caps (decided)

The default wallet policy:
- **Receive** (dividends/payouts): unconstrained (inbound).
- **Stake** the anti-poisoning bond: autonomous, bounded by caps + an
  `allowedRecipients` list = **{ brainblast stake/registry address, owner sweep
  address }** only.
- **Pay for dataset/feed access:** deliberately **not** autonomous — requires an
  explicit human OK (a confirmation, or a one-shot raised cap). A clean future
  toggle, not a rebuild.

## Consent stays separate (honesty guardrail)

The wallet removes **economic** friction, never **consent** friction. Data
*capture* stays behind the existing explicit opt-in (`BRAINBLAST_CONTRIBUTE=1`,
default off). Funding or generating a wallet must never flip consent on — they
remain independent toggles, per the roadmap's "consent is opt-in, revocable,
scoped" promise.

## Command surface

```
brainblast wallet init       # generate, Vault-store, print pubkey + fund URI + ONE-TIME secret backup
brainblast wallet address    # print active pubkey (safe to share, for funding)
brainblast wallet list       # known wallets (pubkey, created, tier) — never secrets
brainblast wallet balance    # SOL / $BRAIN / $USDC vs caps + remaining session budget   [network]
brainblast wallet policy     # show/scaffold the Signguard policy governing this wallet
brainblast wallet sweep <to> # drain everything to the owner address — the panic button   [network]
brainblast wallet rotate     # new key, sweep old → new, re-Vault                          [network]
brainblast wallet delegate   # Tier 2: emit the `approve` tx for the owner to sign         [network]
brainblast wallet revoke     # Tier 2: emit SPL `revoke`; Tier 1: disable autonomous spend
```

Every outbound path routes through one internal `signWithPolicy()` that
simulates the tx, checks Signguard + the session ledger, and refuses fail-closed.

## Storage layout

- Secret: **Vault only** (`~/.brainblast/vault`, encrypted, recoverable by
  pubkey). Never written to a repo file, never logged, surfaced to the user once.
- Manifest: `~/.brainblast/wallet.json` (override `BRAINBLAST_WALLET_FILE`) —
  **non-secret**: active pubkey, createdAt, label, tier. This is the index; the
  secret is reconstructed from the Vault on demand, in memory.

## Phases

- **P0 ✅ — Wallet core + recovery.** Key lifecycle (generate / Vault-store /
  recover-to-memory / address / active-manifest / rotate) + `init` / `address` /
  `list` / `balance` / `sweep` / `rotate` CLI. The secret round-trips through the
  Vault, never lands in a repo path, and a wiped working tree recovers it by
  pubkey. `sweep` (the panic button) and `balance` are RPC-backed; `sweep` is
  fail-closed to a configured owner address.
- **P1 ✅ — Policy-governed staking.** `checkSpend()` gate + session ledger +
  `signWithPolicy()` chokepoint (fail-closed: a refusal never touches the chain).
  `wallet stake` bonds `$BRAIN` on a VTI through the gate; the in-core successor
  to `scripts/agent-stake`, reading the secret from the Vault, not an env var.
  Over-cap / non-allowlisted / unknown-program spends are refused, proven by tests.
- **P2 ✅ — Dividend receive wiring.** The active wallet pubkey is the
  `author_wallet` recorded on every stake, so dividends settle back to it;
  `wallet balance` reflects earned `$BRAIN`/`$USDC`. (Receiving is unconstrained
  inbound — near-zero-risk. The on-chain payout itself is registry/treasury-side.)
- **P3 ✅ — Tier-2 delegation.** `wallet delegate` derives the owner's ATA and
  emits the exact `spl-token approve` for the owner to run; `wallet revoke` emits
  `spl-token revoke` (Tier-2) or zeroes the caps to disable autonomous spend
  (Tier-1). `sendDelegatedTransfer` lets the agent spend the owner's tokens as the
  approved delegate, bounded by the on-chain allowance.

> **What "landed" means here:** the engineering — key handling, the policy gate,
> tx construction, CLI — is built and tested (pure/offline paths fully; the
> RPC-send legs are structured behind the tested gate). What remains before this
> moves real value is operational: funding a wallet on mainnet, the registry-side
> dividend payout, and a real `$BRAIN` price feed for the stake `--brain-amount`.

## Risks

| Risk | Mitigation |
|---|---|
| Agent prompt-injected into draining the wallet | Hard caps + recipient allowlist + `blockUnknownPrograms` (Signguard) |
| Key leak via repo / backup | Vault AES-256-GCM at rest; secret never on a repo path or in a log |
| User over-funds the wallet | `balance`/`init` warn loudly when balance exceeds the session cap; suggest sweeping excess |
| Consent silently enabled by funding | Capture consent stays a separate, default-off toggle |
| "Brand contradiction" perception | Docs make the *sacrificial capped ops wallet* explicit; sweep/rotate always available |

Naming note: deliberately **not** a "brain wallet" (a term for weak
passphrase-derived keys with a long history of being drained). It is the **Agent
Wallet**, keys from a CSPRNG.
