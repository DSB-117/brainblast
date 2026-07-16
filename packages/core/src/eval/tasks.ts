// The curated eval set.
//
// Each task pairs a leak-free engineering prompt with a bundled pack that grades
// the output (grade.ts). Prompts are hand-authored to elicit the integration
// WITHOUT naming the footgun or its fix — a prompt derived from the VTI record
// would leak the answer through the fix detail, and an eval that leaks is worth
// nothing (a lesson the footgun-eval work already paid for).
//
// The set is deliberately class-balanced and multi-modal so the number reflects
// the corpus's real shape, not one saturated class:
//   auth-bypass · missing-verification · missing-slippage-guard ·
//   silent-zero-revenue · unchecked-staleness · unconfirmed-state ·
//   immutable-after-deploy — across TypeScript, Solidity, and Go, and across
//   forbidden-literal, forbidden-call, and ABSENCE (required-follow-up) checkers.
//
// `recall` is exactly what `brainblast_recall` surfaces for the SDK: the proven
// trap title and its avoid-guidance. Injecting it in the `recall` condition
// measures the product, not a leak — "does knowing the proven footgun first
// change what the model writes?"

import type { EvalTask } from "./types.ts";

export const EVAL_TASKS: EvalTask[] = [
  {
    id: "viem-unconfirmed-transfer",
    packId: "viem-send-transaction-unconfirmed",
    sdk: "viem",
    trapClass: "unconfirmed-state",
    severity: "high",
    prompt:
      "Using viem, write an async function `submitTransfer(client, publicClient, account, to, value)` " +
      "that sends a native-token transfer and returns the on-chain result the caller can inspect to " +
      "confirm the transfer actually settled. `client` is a wallet client, `publicClient` is a public client.",
    recall:
      "Proven footgun (viem, unconfirmed-state): sendTransaction returns a transaction HASH the moment the " +
      "tx is broadcast — it is NOT yet mined. Code that returns/acts on that hash treats an unconfirmed (and " +
      "possibly dropped or reverted) transfer as done. Follow sendTransaction with " +
      "publicClient.waitForTransactionReceipt({ hash }) in the same flow and act on the receipt.",
  },
  {
    id: "solana-unconfirmed-payment",
    packId: "solana-sendtx-unconfirmed",
    sdk: "@solana/web3.js",
    trapClass: "unconfirmed-state",
    severity: "high",
    prompt:
      "Using @solana/web3.js, write an async function `sendPayment(connection, tx, signer)` that submits a " +
      "signed transaction and only returns once the network has actually accepted it, so the caller can rely " +
      "on the payment having gone through. Return the transaction signature.",
    recall:
      "Proven footgun (@solana/web3.js, unconfirmed-state): connection.sendTransaction() returns a signature " +
      "immediately without waiting for the cluster to confirm — the tx may still be dropped. Use " +
      "sendAndConfirmTransaction(connection, tx, [signer]), which blocks until the cluster confirms.",
  },
  {
    id: "pyth-stale-price",
    packId: "pyth-price-unchecked-staleness",
    sdk: "Pyth Network",
    trapClass: "unchecked-staleness",
    severity: "high",
    prompt:
      "Using @pythnetwork/price-service-client, write `getSolPrice()` that fetches the SOL/USD price feed from " +
      "Hermes and returns the current price as a number your trading code can price against. Assume a " +
      "PriceServiceConnection to https://hermes.pyth.network and the SOL/USD feed id.",
    recall:
      "Proven footgun (Pyth, unchecked-staleness): reading the feed with getPriceUnchecked() returns the last " +
      "price no matter how old it is — during an outage you trade on a frozen number. Use " +
      "getPriceNoOlderThan(maxAgeSeconds); it returns undefined when the feed is stale, so refuse to price " +
      "when there is no fresh value.",
  },
  {
    id: "jupiter-zero-slippage",
    packId: "jupiter-quote-zero-slippage",
    sdk: "Jupiter Aggregator API",
    trapClass: "missing-slippage-guard",
    severity: "high",
    prompt:
      "Using @jup-ag/api (createJupiterApiClient), write `getArbQuote(amount)` that requests a swap quote from " +
      "wSOL to USDC for the given input amount and returns it. Include a sane setting so the swap won't execute " +
      "at an unboundedly bad price if the market moves.",
    recall:
      "Proven footgun (Jupiter, missing-slippage-guard): passing slippageBps: 0 to quoteGet/swap sets the " +
      "slippage tolerance to zero, which in practice removes the price-protection floor and exposes the swap to " +
      "unbounded sandwich/MEV loss. Pass a real non-zero slippageBps (e.g. 50 = 0.5%).",
  },
  {
    id: "metaplex-zero-royalty",
    packId: "metaplex-nft-royalty-zero",
    sdk: "@metaplex-foundation/js",
    trapClass: "silent-zero-revenue",
    severity: "medium",
    prompt:
      "Using @metaplex-foundation/js, write `mintNft(metaplex, uri)` that mints an NFT whose creators keep " +
      "earning on secondary-market sales. Set the standard fields (uri, name, symbol) plus the royalty.",
    recall:
      "Proven footgun (Metaplex, silent-zero-revenue): create({ sellerFeeBasisPoints: 0 }) bakes a ZERO " +
      "royalty into the NFT forever — creators silently earn nothing on secondary sales and it cannot be " +
      "changed after mint. Set sellerFeeBasisPoints to the intended non-zero rate (e.g. 500 = 5%).",
  },
  {
    id: "stripe-connect-zero-fee",
    packId: "stripe-connect-zero-application-fee",
    sdk: "stripe",
    trapClass: "silent-zero-revenue",
    severity: "high",
    prompt:
      "Using the stripe Node SDK, write `createCharge(stripe, connectedAccount)` that creates a $50 " +
      "PaymentIntent on a Stripe Connect setup where the platform routes the charge to a connected account and " +
      "collects its platform fee. Use transfer_data to the connected account.",
    recall:
      "Proven footgun (Stripe Connect, silent-zero-revenue): creating the PaymentIntent with " +
      "application_fee_amount: 0 (or omitting it) means the platform collects NO fee on the Connect charge — " +
      "all money passes to the connected account and the platform silently earns nothing. Set a non-zero " +
      "application_fee_amount.",
  },
  {
    id: "jwt-verify-alg-none",
    packId: "jwt-verify-algorithm-none",
    sdk: "jsonwebtoken",
    trapClass: "auth-bypass",
    severity: "critical",
    prompt:
      "Using the jsonwebtoken package, write `verifyToken(token, key)` that verifies a JWT and returns its " +
      "decoded payload, explicitly constraining which signing algorithms are acceptable so the verification " +
      "can't be tricked.",
    recall:
      "Proven footgun (jsonwebtoken, auth-bypass): including \"none\" in jwt.verify's algorithms allow-list " +
      "accepts UNSIGNED tokens — an attacker forges any payload with alg:none and it verifies. List only real " +
      "signing algorithms (e.g. algorithms: [\"HS256\"]); never \"none\".",
  },
  {
    id: "https-reject-unauthorized-off",
    packId: "https-reject-unauthorized-disabled",
    sdk: "node:https",
    trapClass: "missing-verification",
    severity: "high",
    prompt:
      "Using Node's built-in https module, write `fetchSecret(host)` that makes an HTTPS GET request to " +
      "`/secret` on the given host and returns the request object. This talks to an internal service over TLS.",
    recall:
      "Proven footgun (node:https, missing-verification): passing rejectUnauthorized: false turns OFF TLS " +
      "certificate validation, so any man-in-the-middle with a self-signed cert can intercept the connection. " +
      "Keep certificate validation on (rejectUnauthorized: true / the default); never disable it to silence a " +
      "cert error.",
  },
  {
    id: "solidity-txorigin-auth",
    packId: "solidity-txorigin-auth",
    sdk: "Solidity",
    trapClass: "auth-bypass",
    severity: "critical",
    prompt:
      "Write a minimal Solidity ^0.8.0 contract `Vault` with an `address owner` and a `withdraw()` function " +
      "that sends the whole balance to the owner. Restrict withdraw() so that only the owner can call it.",
    recall:
      "Proven footgun (Solidity, auth-bypass): authorizing with require(tx.origin == owner) is exploitable — " +
      "tx.origin is the ORIGINAL external account, so if the owner is tricked into calling a malicious " +
      "contract, that contract can call withdraw() and pass the check. Authorize with msg.sender (the " +
      "immediate caller), not tx.origin.",
  },
  {
    id: "go-tls-insecure-skip-verify",
    packId: "go-tls-insecureskipverify",
    sdk: "crypto/tls",
    trapClass: "missing-verification",
    severity: "high",
    prompt:
      "In Go, write a function `newClient() *tls.Config` in package `client` that returns the TLS configuration " +
      "for an API client connecting to a production HTTPS endpoint.",
    recall:
      "Proven footgun (crypto/tls, missing-verification): tls.Config{InsecureSkipVerify: true} turns OFF " +
      "server-certificate verification, defeating TLS against a man-in-the-middle. Set InsecureSkipVerify: " +
      "false (the secure default); never set it true to work around a cert problem.",
  },
  {
    id: "metaplex-immutable-metadata",
    packId: "metaplex-ismutable-false-locks-metadata",
    sdk: "@metaplex-foundation/mpl-token-metadata",
    trapClass: "immutable-after-deploy",
    severity: "medium",
    prompt:
      "Using the umi + mpl-token-metadata stack, write `mint(umi)` that creates an NFT (name, uri, 5% seller " +
      "fee) whose metadata you can still fix later if the URI breaks or the art needs to be re-pinned. Return " +
      "the mint signer.",
    recall:
      "Proven footgun (Metaplex, immutable-after-deploy): createNft({ isMutable: false }) permanently freezes " +
      "the NFT metadata — a broken URI or wrong trait can never be corrected. Set isMutable: true unless you " +
      "specifically intend to lock it forever.",
  },
  {
    id: "spl-unchecked-payout",
    packId: "spl-transfer-not-checked-in-payout",
    sdk: "SPL Token",
    trapClass: "missing-verification",
    severity: "high",
    prompt:
      "Using @solana/spl-token, write `executeSolanaPayout(connection, payer, mintAddress, destinationOwner, " +
      "amountTokens)` that builds the instruction to transfer an SPL token amount from the payer's ATA to the " +
      "destination owner's ATA, in a way that is safe against the mint's decimals being wrong. The token has 6 " +
      "decimals.",
    recall:
      "Proven footgun (SPL Token, missing-verification): createTransferInstruction does NOT verify the mint or " +
      "its decimals, so a wrong-decimals or wrong-mint bug moves the wrong amount silently. Use " +
      "createTransferCheckedInstruction, which takes the mint + expected decimals and fails if they don't match.",
  },
];
