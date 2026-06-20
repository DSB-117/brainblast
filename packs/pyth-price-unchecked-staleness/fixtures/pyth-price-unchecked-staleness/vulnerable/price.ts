import { PriceServiceConnection } from "@pythnetwork/price-service-client";

const connection = new PriceServiceConnection("https://hermes.pyth.network");
const SOL_USD = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

// VULNERABLE — getPriceUnchecked() ignores staleness. If the SOL/USD feed
// stops updating, this returns the last (possibly very old) price and the
// caller trades against it with no guard.
export async function getSolPrice() {
  const feeds = await connection.getLatestPriceFeeds([SOL_USD]);
  const feed = feeds![0];
  const price = feed.getPriceUnchecked();
  return Number(price.price) * 10 ** price.expo;
}
