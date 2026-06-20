import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher.js";
import BN from "bn.js";

async function sendBundle(opts: { transactions: any[]; tipLamports: BN }) {
  const client = searcherClient("https://mainnet.block-engine.jito.wtf");
  return (client as any).sendBundle(opts.transactions, opts.tipLamports);
}

// FIXED — a nonzero tip (100,000 lamports) so the block engine can prioritize
// the bundle. In production, scale the tip with observed competition.
export async function submitArb(transactions: any[]) {
  return sendBundle({ transactions, tipLamports: new BN(100_000) });
}
