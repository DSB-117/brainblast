# /brainblast-packs

The Protocol Pack Library. Every Solana app is built on some combination of Jupiter, Raydium, Pyth, Meteora, Jito, … — each with its own silent footguns. Opt into research-and-enforcement for the exact stack you build on.

## Usage

List the bundled packs by protocol name:

```bash
npx brainblast packs
```

Then audit with the packs for your stack (each is opt-in, not loaded by default):

```bash
npx brainblast --packs jupiter,pyth .
```

`--packs <name>` resolves a protocol name (e.g. `pyth`) to its bundled pack, or takes an explicit pack directory. Packs are pure data (rules bind only to vetted checker templates) and every rule ships `vulnerable/`+`fixed/` fixtures proven RED → GREEN.

## Bundled protocols

`jupiter` (zero-slippage quote) · `raydium` (zero-slippage swap) · `pyth` (unchecked price staleness) · `meteora` (zero min-out) · `jito` (zero bundle tip) · `metaplex` (zero royalties) · `solana` (sendTransaction unconfirmed) · `spl` (unchecked transfer).

Validate or author a pack:

```bash
npx brainblast pack validate <dir>
npx brainblast pack init packs/<id> --id <id> --name "<name>" --author <you>
```
