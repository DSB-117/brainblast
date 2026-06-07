# Changelog

All notable changes to the `brainblast` npm package are documented here.

## 0.2.0 — 2026-06-07

First public release, published to npm with [SLSA provenance](https://slsa.dev/) attestation via
GitHub Actions OIDC.

- **Deterministic offline auditor + `npx brainblast` CLI** — scans a repo for built-in integration
  traps without network access or an LLM, emits CI-readable `checks[]` / `checkTotals` into
  `report.json`, and can generate behavioral contract tests that fail on the vulnerable shape and
  pass on the fixed one.
- **Three built-in guardrails (CRITICAL severity)**:
  - Stripe webhook raw-body signature verification (forged-event acceptance).
  - Privy/JWT signature + `aud` + `iss` verification (auth bypass via decode-only tokens).
  - Bags/Solana fee-share creator inclusion — catches a config that omits the creator wallet from
    `feeClaimers` or whose `userBps` don't sum to 10,000, a permanent zero-revenue misconfiguration
    that cannot be corrected after launch.
- **Data-driven rules** — checks bind to vetted checker/test-template kinds via committed YAML; no
  executable code ships in a rule. Project-local `.agent-research/rules/*.yaml` rules load
  alongside the bundled pack without shadowing it.
- **RED→GREEN proof** (`npm run prove`) — every generated contract test is proven to fail against
  the vulnerable fixture and pass against the fixed one before it ships.
