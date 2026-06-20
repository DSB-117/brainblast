# /brainblast-fee-configs

Fee Config Validator: the generalized Bags exploit. A curated catalog of the **silent zero-revenue class** — revenue-bearing config fields (fees, royalties, rewards) that, if omitted or set to zero, quietly collect nothing forever. The call succeeds, nothing reverts, and a creator/treasury/holder simply earns $0.

Each entry names the SDK, the exact field, what zero/omitted costs you, and — when one exists — the **bundled brainblast rule** that statically detects it. An integrity test guarantees every referenced rule actually exists.

## Usage

```
/brainblast-fee-configs [id] [--json]
```

```bash
npx brainblast fee-configs $ARGUMENTS
```

Run with no argument to list the catalog (fees · royalties · rewards) with enforced/advisory status, or pass an id to see one in detail.

The companion static rule **`metaplex-seller-fee-zero`** (and the general `fee-configs-zero-or-missing` checker) fail a build when a Metaplex token is created with `sellerFeeBasisPoints` omitted or zero — creators earn no royalties on secondary sales. Catalog entries marked _advisory_ have no bundled rule yet (e.g. Token-2022 transfer fee, generic reward rates) and are grep targets / project-local rule candidates.

Writes the full catalog to `.agent-research/fee-configs.md`.
