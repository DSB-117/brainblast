// VULNERABLE: file imports TOKEN_2022_PROGRAM_ID (signal of intent) but the
// createMint call passes TOKEN_PROGRAM_ID (legacy). The mint deploys, looks
// fine in explorers, and silently lacks every Token-2022 feature the project
// presumably picked Token-2022 for. There is no on-chain fix.
import {
  createMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import type { Connection, Keypair, PublicKey } from "@solana/web3.js";

export async function launchToken(opts: {
  connection: Connection;
  payer: Keypair;
  mintAuthority: PublicKey;
  freezeAuthority: PublicKey | null;
  decimals: number;
}): Promise<PublicKey> {
  return createMint(
    opts.connection,
    opts.payer,
    opts.mintAuthority,
    opts.freezeAuthority,
    opts.decimals,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
  );
}
