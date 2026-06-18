# /brainblast-idl-rules

Generate brainblast security rules from an Anchor IDL. The generated rule scans your program's Rust source and verifies it actually declares every account constraint the IDL promises — every `isSigner` account must be a `Signer<'info>`, every `isMut` account must carry `mut`/`init`. A missing constraint is a silent authorization hole.

## Usage

```
/brainblast-idl-rules <idl.json> [--out <dir>] [--json]
```

```bash
npx brainblast idl-rules $ARGUMENTS
```

`--out` writes the rule YAML into a pack directory; run it against your program with `npx brainblast <program-dir> --packs <dir>`.
