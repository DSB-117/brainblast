# /brainblast-pump-check

Launch pre-flight for pump.fun / SPL token builders. Run before you list or integrate a token.

Reads the on-chain SPL mint account (is the **mint authority** revoked? is the **freeze authority** revoked?), verifies identity, and folds in a Rico Maps forensic scan (risk score, snipers, bundle clusters, holders, deployer flags) into one **GO / CAUTION / NO-GO** checklist.

## Usage

```
/brainblast-pump-check <mint> [--rpc URL] [--api-key KEY] [--fail-on SCORE] [--offline] [--json]
```

```bash
npx brainblast pump-check $ARGUMENTS
```

Exit 1 on NO-GO. A live mint authority (unlimited supply dilution) is an automatic NO-GO.
