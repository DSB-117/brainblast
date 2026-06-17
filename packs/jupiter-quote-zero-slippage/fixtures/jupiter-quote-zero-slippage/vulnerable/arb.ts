import { createJupiterApiClient } from "@jup-ag/api";

const jupiterQuoteApi = createJupiterApiClient();

const wSolMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function getArbQuote(amountInJSBI: number) {
  return jupiterQuoteApi.quoteGet({
    inputMint: wSolMint,
    outputMint: usdcMint,
    amount: amountInJSBI,
    onlyDirectRoutes: false,
    slippageBps: 0,
    maxAccounts: 20,
  });
}
