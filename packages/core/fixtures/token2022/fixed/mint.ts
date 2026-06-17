// FIXED: createMint's 8th argument is TOKEN_2022_PROGRAM_ID, matching the
// import the file already declared. Token-2022 features (transfer hooks,
// transfer fees, confidential transfers) are available on this mint.
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
    TOKEN_2022_PROGRAM_ID,
  );
}
