import { PriceServiceConnection } from "@pythnetwork/price-service-client";

const connection = new PriceServiceConnection("https://hermes.pyth.network");
const SOL_USD = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

// FIXED — getPriceNoOlderThan(60) returns undefined when the feed is more than
// 60 seconds old, so we refuse to price against a stale oracle.
export async function getSolPrice() {
  const feeds = await connection.getLatestPriceFeeds([SOL_USD]);
  const feed = feeds![0];
  const price = feed.getPriceNoOlderThan(60);
  if (!price) throw new Error("Pyth SOL/USD price is stale (>60s) — refusing to trade");
  return Number(price.price) * 10 ** price.expo;
}
