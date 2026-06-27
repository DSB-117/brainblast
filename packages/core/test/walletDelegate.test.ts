import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { resolveMint, buildDelegateInstructions, buildRevokeInstructions } from "../src/wallet/delegate.ts";
import { USDC_MINT, brainMint } from "../src/wallet/chain.ts";

describe("Tier-2 delegation (owner-signed allowance) — offline construction", () => {
  it("resolveMint maps token aliases to the right mints", () => {
    expect(resolveMint("brain").mint).toBe(brainMint());
    expect(resolveMint("$BRAIN").label).toBe("$BRAIN");
    expect(resolveMint("usdc").mint).toBe(USDC_MINT);
    expect(resolveMint("usdc").label).toBe("USDC");
    // An unrecognized token is treated as a raw mint address.
    expect(resolveMint("SomeRawMint111").mint).toBe("SomeRawMint111");
  });

  it("builds an `approve` command against the OWNER's derived token account", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const agent = Keypair.generate().publicKey.toBase58();
    const d = await buildDelegateInstructions({ ownerPubkey: owner, agentPubkey: agent, token: "usdc", uiAmount: 100 });

    // The allowance is set on the owner's ATA, delegated to the agent.
    const expectedAta = (await getAssociatedTokenAddress(new PublicKey(USDC_MINT), new PublicKey(owner))).toBase58();
    expect(d.ownerTokenAccount).toBe(expectedAta);
    expect(d.delegate).toBe(agent);
    expect(d.uiAmount).toBe(100);
    expect(d.approveCommand).toContain("spl-token approve");
    expect(d.approveCommand).toContain(expectedAta);
    expect(d.approveCommand).toContain(agent);
  });

  it("builds a matching `revoke` command on the same owner account", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    const d = await buildDelegateInstructions({ ownerPubkey: owner, agentPubkey: "agent", token: "brain", uiAmount: 1 });
    const r = await buildRevokeInstructions({ ownerPubkey: owner, token: "brain" });
    expect(r.ownerTokenAccount).toBe(d.ownerTokenAccount);
    expect(r.revokeCommand).toContain("spl-token revoke");
    expect(r.revokeCommand).toContain(r.ownerTokenAccount);
  });
});
