# /brainblast-batch

Risk-rank a list of Solana contract addresses in parallel — identity + Rico Maps forensics — for curating which tokens your app should support.

Pass a file of CAs (newline-separated or a JSON array). Returns a ranked matrix with impersonators floated to the top, then by risk score.

## Usage

```
/brainblast-batch <file> [--concurrency N] [--api-key KEY] [--fail-on SCORE] [--offline] [--json]
```

```bash
npx brainblast batch $ARGUMENTS
```

Exit 1 if any address is an impersonator or exceeds the risk threshold.
