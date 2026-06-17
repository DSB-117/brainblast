import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  rentExemptMinimum,
  lamportsToSol,
  analyzeCosts,
  renderCostReportMd,
} from "../src/costAnalysis.ts";

// ── Formula unit tests ───────────────────────────────────────────────────────

describe("rentExemptMinimum", () => {
  it("SPL Token account (165 bytes) = 2,039,280 lamports", () => {
    expect(rentExemptMinimum(165)).toBe(2_039_280);
  });

  it("SPL Mint (82 bytes) = 1,461,600 lamports", () => {
    expect(rentExemptMinimum(82)).toBe(1_461_600);
  });

  it("zero-data system account (0 bytes) = 890,880 lamports", () => {
    expect(rentExemptMinimum(0)).toBe(890_880);
  });

  it("overhead-only formula: (dataLen + 128) * 6960", () => {
    expect(rentExemptMinimum(100)).toBe((100 + 128) * 6960);
  });
});

describe("lamportsToSol", () => {
  it("formats 1 SOL", () => {
    expect(lamportsToSol(1_000_000_000)).toBe("1");
  });

  it("formats fractional SOL without trailing zeros", () => {
    expect(lamportsToSol(2_039_280)).toBe("0.00203928");
  });

  it("formats 0", () => {
    expect(lamportsToSol(0)).toBe("0");
  });
});

// ── analyzeCosts integration tests ──────────────────────────────────────────

function fixture(code: string, filename = "handler.ts"): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-cost-"));
  writeFileSync(join(dir, filename), code, "utf8");
  return dir;
}

describe("analyzeCosts — account flow detection", () => {
  it("detects createMint from @solana/spl-token", () => {
    const dir = fixture(`
import { createMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
export async function setupMint(conn: any, payer: any) {
  return createMint(conn, payer, payer.publicKey, null, 9);
}
`);
    try {
      const r = analyzeCosts(dir);
      expect(r.accountFlows).toHaveLength(1);
      const f = r.accountFlows[0];
      expect(f.call).toBe("createMint");
      expect(f.accountType).toBe("SPL Token Mint");
      expect(f.lamports).toBe(1_461_600);
      expect(f.sol).toBe("0.0014616");
      expect(f.scalable).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects createAssociatedTokenAccount from @solana/spl-token", () => {
    const dir = fixture(`
import { createAssociatedTokenAccount } from "@solana/spl-token";
export async function setupAta(conn: any, payer: any, mint: any, owner: any) {
  return createAssociatedTokenAccount(conn, payer, mint, owner);
}
`);
    try {
      const r = analyzeCosts(dir);
      expect(r.accountFlows).toHaveLength(1);
      expect(r.accountFlows[0].call).toBe("createAssociatedTokenAccount");
      expect(r.accountFlows[0].lamports).toBe(2_039_280);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects createV1 from @metaplex-foundation/mpl-token-metadata as non-recoverable", () => {
    const dir = fixture(`
import { createV1 } from "@metaplex-foundation/mpl-token-metadata";
export async function mintMeta(umi: any) {
  await createV1(umi, { name: "T", isMutable: false });
}
`);
    try {
      const r = analyzeCosts(dir);
      expect(r.accountFlows).toHaveLength(1);
      const f = r.accountFlows[0];
      expect(f.call).toBe("createV1");
      expect(f.recoverability).toBe("non-recoverable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT flag createMint from an unimported module (scope gate)", () => {
    const dir = fixture(`
// no import from @solana/spl-token
export async function mintToken() {
  return createMint({} as any, {} as any, {} as any, null, 9);
}
`);
    try {
      const r = analyzeCosts(dir);
      expect(r.accountFlows).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks calls inside .map() as scalable", () => {
    const dir = fixture(`
import { createAssociatedTokenAccount } from "@solana/spl-token";
export async function airdrop(conn: any, payer: any, mint: any, wallets: any[]) {
  return Promise.all(
    wallets.map((w) => createAssociatedTokenAccount(conn, payer, mint, w))
  );
}
`);
    try {
      const r = analyzeCosts(dir);
      expect(r.accountFlows).toHaveLength(1);
      expect(r.accountFlows[0].scalable).toBe(true);
      expect(r.accountFlows[0].scalableNote).toContain(".map()");
      expect(r.scalableFlows).toHaveLength(1);
      expect(r.totalLockupLamports).toBe(0); // scalable flows excluded from static total
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks calls inside for...of as scalable", () => {
    const dir = fixture(`
import { createAssociatedTokenAccount } from "@solana/spl-token";
export async function batchCreate(conn: any, payer: any, mint: any, owners: any[]) {
  for (const owner of owners) {
    await createAssociatedTokenAccount(conn, payer, mint, owner);
  }
}
`);
    try {
      const r = analyzeCosts(dir);
      expect(r.accountFlows).toHaveLength(1);
      expect(r.accountFlows[0].scalable).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("totalLockupLamports sums only static (non-scalable) flows", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-cost-multi-"));
    try {
      // Static mint creation
      writeFileSync(join(dir, "setup.ts"), `
import { createMint } from "@solana/spl-token";
export async function setup(conn: any, payer: any) {
  return createMint(conn, payer, payer.publicKey, null, 9);
}
`, "utf8");
      // Scalable ATA creation
      writeFileSync(join(dir, "airdrop.ts"), `
import { createAssociatedTokenAccount } from "@solana/spl-token";
export async function drop(conn: any, payer: any, mint: any, ws: any[]) {
  return Promise.all(ws.map((w) => createAssociatedTokenAccount(conn, payer, mint, w)));
}
`, "utf8");

      const r = analyzeCosts(dir);
      expect(r.accountFlows).toHaveLength(2);
      // Only the mint is static; ATA is scalable
      expect(r.totalLockupLamports).toBe(1_461_600); // just the mint
      expect(r.scalableFlows).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("analyzeCosts — priority fee detection", () => {
  it("reports missing setComputeUnitPrice", () => {
    const dir = fixture(`
import { createMint } from "@solana/spl-token";
export async function f(c: any, p: any) { return createMint(c, p, p.publicKey, null, 9); }
`);
    try {
      const r = analyzeCosts(dir);
      expect(r.priorityFee.found).toBe(false);
      expect(r.priorityFee.detail).toContain("setComputeUnitPrice");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects setComputeUnitPrice call", () => {
    const dir = fixture(`
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
export function buildTx() {
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
  return tx;
}
`);
    try {
      const r = analyzeCosts(dir);
      expect(r.priorityFee.found).toBe(true);
      expect(r.priorityFee.detail).toContain("setComputeUnitPrice");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderCostReportMd", () => {
  it("includes HIGH warning when priority fee is absent", () => {
    const dir = fixture(`
import { createMint } from "@solana/spl-token";
export async function f(c: any, p: any) { return createMint(c, p, p.publicKey, null, 9); }
`);
    try {
      const r = analyzeCosts(dir);
      const md = renderCostReportMd(r);
      expect(md).toContain("HIGH");
      expect(md).toContain("setComputeUnitPrice");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes lamport lockup total and recoverability column", () => {
    const dir = fixture(`
import { createMint } from "@solana/spl-token";
export async function f(c: any, p: any) { return createMint(c, p, p.publicKey, null, 9); }
`);
    try {
      const r = analyzeCosts(dir);
      const md = renderCostReportMd(r);
      expect(md).toContain("1,461,600");
      expect(md).toContain("Conditional");
      expect(md).toContain("Total static lockup");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks scalable flows with 🔄 in the table", () => {
    const dir = fixture(`
import { createAssociatedTokenAccount } from "@solana/spl-token";
export async function drop(c: any, p: any, m: any, ws: any[]) {
  return Promise.all(ws.map((w) => createAssociatedTokenAccount(c, p, m, w)));
}
`);
    try {
      const r = analyzeCosts(dir);
      const md = renderCostReportMd(r);
      expect(md).toContain("🔄");
      expect(md).toContain("Scalable Cost Flows");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
