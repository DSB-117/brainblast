import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher.js";
import BN from "bn.js";

// A thin project wrapper around the Jito searcher client, as most teams write.
async function sendBundle(opts: { transactions: any[]; tipLamports: BN }) {
  const client = searcherClient("https://mainnet.block-engine.jito.wtf");
  // ... build bundle with the tip, then client.sendBundle(...)
  return (client as any).sendBundle(opts.transactions, opts.tipLamports);
}

// VULNERABLE — tipLamports: new BN(0). The bundle has no tip, so the Jito block
// engine deprioritizes it and it never lands under competition. sendBundle
// still returns a bundle id, so the caller assumes the transactions submitted.
export async function submitArb(transactions: any[]) {
  return sendBundle({ transactions, tipLamports: new BN(0) });
}
