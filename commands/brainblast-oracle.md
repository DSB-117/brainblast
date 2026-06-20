# /brainblast-oracle

Live On-Chain Intelligence: **is the oracle fresh?** Before you price anything against a Pyth / Switchboard / Chainlink feed, check when its account was last written.

Provider-agnostic — instead of parsing each oracle's binary layout, it measures the one universal signal: the slot of the most recent transaction touching the account vs. the current slot. A feed that hasn't updated recently is exactly how protocols get drained at the wrong price.

## Usage

```
/brainblast-oracle <account> [--rpc URL] [--max-staleness-slots N | --max-staleness-seconds N] [--json]
```

```bash
npx brainblast oracle $ARGUMENTS
```

- `--rpc URL` — use your own endpoint (the public RPC is rate-limited; pass Helius/Triton for reliable results).
- `--max-staleness-slots N` — staleness threshold in slots (default 150 ≈ 60s).
- `--max-staleness-seconds N` — threshold in seconds (converted at ~400ms/slot).
- `--json` — machine-readable result for an agent.

Reports `FRESH` / `STALE` / `NO_HISTORY` with how many slots/seconds ago the feed last updated. **Exit 1 on STALE or NO_HISTORY** — wire it into a pre-trade gate. A markdown report is written to `.agent-research/oracle-freshness.md`.

> Related: `brainblast trust-graph <programId…>` now classifies upgrade authority **live** — single-key vs **multisig** (Squads) vs **DAO** (SPL Governance) — by reading the authority account's owner program, and shows an at-a-glance trust line (authority · verified build · audited).
