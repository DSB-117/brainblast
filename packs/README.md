# Protocol Pack Library

Every Solana app is built on some combination of Jupiter, Raydium, Pyth, Meteora, Jito, … — each with its own silent footguns. A **pack per protocol** means you opt into research-and-enforcement for the exact stack you build on, before a line is written:

```bash
brainblast --packs jupiter,pyth .
```

Packs are **opt-in** (not loaded by default), **pure data** (rules bind only to brainblast's vetted checker templates — no executable code ships in a pack), and **proven** (every rule ships `vulnerable/` + `fixed/` fixtures that must go RED → GREEN). List them anytime:

```bash
brainblast packs            # the library, by protocol name
brainblast pack validate <dir>   # re-prove a pack RED → GREEN
```

## Bundled packs

| Protocol | Pack | Trap |
|----------|------|------|
| **Jupiter** | `jupiter-quote-zero-slippage` | `quoteGet({ slippageBps: 0 })` — MEV/sandwich exposure |
| **Raydium** | `raydium-compute-zero-slippage` | `computeAmountOut({ slippage: 0 })` — no min-out floor |
| **Pyth** | `pyth-price-unchecked-staleness` | `getPriceUnchecked()` — trades on a stale oracle |
| **Meteora** | `meteora-dlmm-zero-min-out` | `swap({ minOutAmount: new BN(0) })` — no slippage floor |
| **Jito** | `jito-bundle-zero-tip` | `sendBundle({ tipLamports: new BN(0) })` — bundle never lands |
| **Metaplex** | `metaplex-nft-royalty-zero` | `create({ sellerFeeBasisPoints: 0 })` — zero royalties |
| **Solana** | `solana-sendtx-unconfirmed` | `sendTransaction()` without confirmation — silent drop |
| **SPL** | `spl-transfer-not-checked-in-payout` | `createTransferInstruction` vs `…Checked` |

`--packs <name>` resolves a protocol name (e.g. `pyth`) to its pack, or takes an explicit pack directory.

## The compounding moat

Each pack someone contributes makes brainblast more valuable for the next dev building on that protocol. To add one: `brainblast pack init packs/<id> --id <id> …`, write a rule that binds to a vetted checker, add `fixtures/<id>/{vulnerable,fixed}/`, and `brainblast pack validate packs/<id>` until it proves RED → GREEN. See any pack here as a template.
