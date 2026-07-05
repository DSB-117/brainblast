import { SyntaxKind } from "ts-morph";

// required-followup-call-missing — a NEW static MODALITY proposed by the fleet
// (Move 2). Every other checker asserts on a node that is PRESENT (a forbidden
// literal, a wrong positional arg, a struct field). This one is the mirror image:
// it asserts on a node that is ABSENT. A call establishes an obligation
// (`triggerCall`) and the code is only correct if a required follow-up
// (`requiredCalls`) is discharged in the SAME function scope. When the follow-up
// never appears, the happy path still compiles and returns — it just silently
// skips the confirmation/verification the trigger demands. This is the shape
// behind the unconfirmed-state / staleness footguns the presence-checkers
// structurally cannot see:
//   viem:   const hash = await client.sendTransaction(req)   // no waitForTransactionReceipt → fire-and-forget
//   viem:   const hash = await client.writeContract(req)     // hash returned as if mined
//   ethers: const tx = await signer.sendTransaction(req)     // no tx.wait() → unconfirmed
// Crucially the fix ADDS the follow-up (the trigger stays put), so the fixed
// fixture is a genuine GREEN pass — not an abstain. That is what lets an absence
// check prove RED→GREEN through the same static oracle everything else uses.
//
// Pure: imports only ts-morph.
//
// params:
//   triggerCall   : string     — the call that creates the obligation
//   requiredCalls : string[]   — ANY ONE of these, in scope, discharges it
//                                (also accepts a single `requiredCall` string)
//   passDetail / failDetail / absentTriggerDetail
export const checker = (c: any, p: any) => {
  const callName = (ce: any): string | null => {
    const expr = ce.getExpression?.();
    if (!expr) return null;
    if (expr.getKind() === SyntaxKind.Identifier) return expr.getText();
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) return expr.getName?.() ?? null;
    return null;
  };

  const required: string[] = Array.isArray(p.requiredCalls)
    ? p.requiredCalls
    : p.requiredCall != null
      ? [p.requiredCall]
      : [];

  // Every call/constructor name reachable inside this function scope (nested
  // closures included — a follow-up in a `.then()` or inner helper still counts,
  // which keeps the check conservative and false-positive-averse).
  const names = [
    ...c.fn.getDescendantsOfKind(SyntaxKind.CallExpression),
    ...c.fn.getDescendantsOfKind(SyntaxKind.NewExpression),
  ]
    .map(callName)
    .filter((n: string | null): n is string => n != null);

  // No trigger in this scope → the obligation never arose. Abstain (cant_tell),
  // NOT pass — a scope that merely matches nameRegex without ever calling the
  // trigger must never be scored as a false GREEN.
  if (!names.includes(p.triggerCall)) {
    return {
      result: "cant_tell",
      detail: p.absentTriggerDetail ?? `no ${p.triggerCall} call in this scope — this rule does not apply here`,
    };
  }

  // Trigger present + at least one required follow-up in scope → obligation met.
  const satisfied = required.find((r) => names.includes(r));
  if (satisfied) {
    return {
      result: "pass",
      detail: p.passDetail ?? `${p.triggerCall} is followed by ${satisfied} in the same scope`,
    };
  }

  // Trigger present, NONE of the required follow-ups anywhere in scope → the
  // obligation is silently dropped. This is the trap.
  return {
    result: "fail",
    detail:
      p.failDetail ??
      `${p.triggerCall} is called but none of its required follow-ups [${required.join(", ")}] appears in this scope`,
  };
};
