# /brainblast-firewall

Inspect a serialized Solana transaction **before signing it** — the AI-agent transaction firewall.

Decodes the transaction locally (legacy + v0/versioned, address lookup tables), flags dangerous patterns (delegate `Approve`, `SetAuthority`, program upgrades, unknown programs), and — with an RPC endpoint — simulates it to surface the full CPI tree. Returns an `allow` / `warn` / `block` verdict.

## Usage

```
/brainblast-firewall <base64-tx> [--rpc URL] [--no-simulate] [--strict] [--json]
```

```bash
npx brainblast firewall $ARGUMENTS
```

Exit codes: `0` allow/warn · `1` block (or any warn with `--strict`). Run this before any autonomous signing step.
