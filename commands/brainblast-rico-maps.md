Check a Solana token's identity and safety with Rico Maps. Contract address (mint): $ARGUMENTS

Run this in two parts:

1. **Identity (always, no key needed).** The command verifies the mint against the canonical token registry — confirming it is the real USDC / JUP / etc. you think it is, and flagging impersonators (a token whose on-chain symbol matches a blue-chip but whose address does not).

2. **Quality (Rico Maps, key optional).** Risk score (0–100), sniper %, cabal funders, Jito bundle clusters, and deployer flags (mint/freeze authority, mutable metadata).

**API key handling:** the Rico Maps quality scan needs an API key.
- If the `RICO_API_KEY` environment variable is set, use it automatically.
- Otherwise, ask the user: "Do you have a Rico Maps API key? (get one at https://app.venum.dev / https://ricomaps.fun — or reply 'skip' to run identity-only.)" If they provide one, pass it with `--api-key`. If they say skip (or have none), run without a key — the command graceful-skips the quality scan and still returns identity.

Then run:

```sh
npx brainblast rico $ARGUMENTS [--api-key <key>] [--expect <SYMBOL>] [--fail-on <0-100>]
```

- Add `--expect <SYMBOL>` if the user said which token it should be (e.g. `--expect USDC`) — the command fails if the mint is not that verified token.
- `--fail-on` defaults to 70; the command exits non-zero on impersonation, an expected-symbol mismatch, or a risk score at/above the threshold — so it can gate CI.
- Add `--offline` to run identity-only with no network at all.

Report the verdict plainly: is it the real token, and is it safe to support?
