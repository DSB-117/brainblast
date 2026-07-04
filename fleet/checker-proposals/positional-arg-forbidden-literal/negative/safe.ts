import { Connection } from "@solana/web3.js";
import crypto from "node:crypto";

// Known-good code the proposed checker MUST NOT flag. If it fires `fail` on any of
// these, it is unsound and the gate rejects it.

// Safe commitment as the positional arg — not the forbidden "processed".
export function makeConfirmed(url: string) {
  return new Connection(url, "confirmed");
}

export function makeFinalized(url: string) {
  return new Connection(url, "finalized");
}

// No commitment positional arg at all — the checker must abstain (cant_tell), not fail.
export function makeDefault(url: string) {
  return new Connection(url);
}

// A non-literal positional arg (a variable) — cannot be determined statically; abstain.
export function makeFromVar(url: string, level: any) {
  return new Connection(url, level);
}

// A different call entirely with a "processed" string somewhere else — the checker
// keys off `call`+`argIndex`, so this must not fire.
export function unrelated() {
  return crypto.createHash("sha256").update("processed").digest("hex");
}
