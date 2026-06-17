# /brainblast-rico-maps

Runs a two-part token check on any Solana contract address (CA):

1. **Identity** — verifies the token against Jupiter's canonical registry and a bundled snapshot of blue-chip mints (USDC, USDT, SOL, JUP, etc.). Flags impersonators claiming canonical symbols at wrong addresses.

2. **Quality** — calls Rico Maps `/api/v1/analyze` for forensic risk scoring: holder concentration, cabal detection, snipers, bundle clusters, deployer flags.

## Usage

```
/brainblast-rico-maps <contract-address> [--expect SYMBOL] [--api-key KEY] [--fail-on SCORE] [--offline]
```

- `--expect SYMBOL` — assert the token should be this symbol; fails if wrong
- `--api-key KEY` — Rico Maps API key (prompted interactively if absent)  
- `--fail-on SCORE` — exit 1 if risk score ≥ this value (default: 70)
- `--offline` — skip network calls; identity check uses bundled snapshot only

## What it does

```bash
npx brainblast rico $ARGUMENTS
```

Exit codes:
- `0` — identity ok, risk score below threshold
- `1` — impersonation detected, expect mismatch, or risk score ≥ threshold

## API key

Rico Maps offers an anonymous free tier (10 req/min, 1000/month). If no key is provided, the command attempts an anonymous request. If the server rejects it, you'll be prompted:

```
No Rico Maps API key found. Options:
  [s]kip  — skip the quality scan, identity check only
  [k]ey   — enter your API key (ricomaps.fun/dashboard)
```
