# /brainblast-score

A 0–100 trust score and A–F grade for any deployed Solana program: upgrade authority (renounced > DAO > multisig > single-key), verified build, audits, directory curation, and cross-cluster parity — with a transparent factor breakdown.

## Usage

```
/brainblast-score <program-id> [--rpc URL] [--no-probe] [--min A|B|C|D|F] [--json]
```

```bash
npx brainblast score $ARGUMENTS
```

`--min` gates a pipeline (exit 1 below the bar). `--json` makes it an oracle other tools can consume.
