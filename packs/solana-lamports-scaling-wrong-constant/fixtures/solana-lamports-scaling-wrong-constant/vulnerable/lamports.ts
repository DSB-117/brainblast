// VULNERABLE: wrong scaling constant. 1 SOL is 1_000_000_000 lamports (1e9), not
// 1_000_000 (1e6). This type-checks and looks plausible, but every conversion is
// off by 1000x — a transfer of "1 SOL" sends 0.001 SOL. No static rule has a
// signature for "wrong constant"; the differential oracle catches it by running
// the function against the vetted golden table.
const LAMPORTS_PER_SOL = 1_000_000;

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}
