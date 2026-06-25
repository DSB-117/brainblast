// FIXED: the correct scaling constant. 1 SOL === 1_000_000_000 lamports (1e9).
// Every conversion now matches the vetted golden I/O table (GREEN).
const LAMPORTS_PER_SOL = 1_000_000_000;

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}
