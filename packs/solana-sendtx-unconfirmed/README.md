# solana-sendtx-unconfirmed

**Severity:** HIGH

## What's the trap?

`@solana/web3.js` exposes two ways to send a transaction:

| Call | Behaviour |
|------|-----------|
| `connection.sendTransaction(tx, signers)` | Submits to the cluster and returns a signature **immediately** — fire-and-forget. |
| `sendAndConfirmTransaction(connection, tx, signers)` | Waits until the transaction is **confirmed** before returning; throws if it fails or is dropped. |

AI code generators routinely emit `sendTransaction()` because it matches the shape of "send a thing and get a result." The transaction returns a signature that *looks* like success, but the transaction may still be dropped due to network congestion, a validator restart, or blockhash expiry.

## Why it's silent

`sendTransaction()` resolves as soon as the RPC node accepts the transaction — not when it lands on-chain. The returned signature is valid regardless of whether the transaction was ever included in a block. Code that credits a user, debits inventory, or records a transfer immediately after this call will think it succeeded even when the on-chain state was never changed.

## The fix

```typescript
// BEFORE (vulnerable)
const sig = await connection.sendTransaction(tx, [signer]);

// AFTER (fixed)
import { sendAndConfirmTransaction } from "@solana/web3.js";
const sig = await sendAndConfirmTransaction(connection, tx, [signer]);
```

## References

- [Solana web3.js docs — sendAndConfirmTransaction](https://solana-labs.github.io/solana-web3.js/)
- Solana Cookbook: "Sending Transactions" — always confirm before crediting
