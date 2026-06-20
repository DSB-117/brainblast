import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rentExemptMinimum } from "../src/costAnalysis.ts";
import {
  buildDeployPlan,
  findProgramBinary,
  renderDeployPlanMd,
  renderDeployPlanText,
} from "../src/deployPlan.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (p: string) => resolve(here, "..", "fixtures", "deploy-plan", p);

describe("deploy-plan: Anchor init-account parsing", () => {
  const plan = buildDeployPlan(fx("anchor"), { programLen: 1500 });

  it("finds both init accounts with literal space resolved to rent", () => {
    const treasury = plan.initAccounts.find((a) => a.name === "treasury");
    const config = plan.initAccounts.find((a) => a.name === "config");
    expect(treasury).toBeDefined();
    expect(config).toBeDefined();
    expect(treasury!.space).toBe(8 + 32 + 1);
    expect(config!.space).toBe(8 + 2);
    expect(treasury!.rentLamports).toBe(rentExemptMinimum(41));
    expect(config!.rentLamports).toBe(rentExemptMinimum(10));
  });

  it("extracts seeds, payer, and struct for each init account", () => {
    const treasury = plan.initAccounts.find((a) => a.name === "treasury")!;
    expect(treasury.struct).toBe("Initialize");
    expect(treasury.payer).toBe("payer");
    expect(treasury.seeds).toContain("treasury");
    expect(treasury.conditional).toBe(false);
  });

  it("excludes non-init accounts (payer, system_program)", () => {
    const names = plan.initAccounts.map((a) => a.name);
    expect(names).not.toContain("payer");
    expect(names).not.toContain("system_program");
  });

  it("sums init rent across all init accounts", () => {
    expect(plan.initRentLamports).toBe(rentExemptMinimum(41) + rentExemptMinimum(10));
    expect(plan.unresolvedInit).toHaveLength(0);
  });
});

describe("deploy-plan: BPF upgradeable-loader economics", () => {
  const len = 1500;
  const plan = buildDeployPlan(fx("anchor"), { programLen: len });

  it("program data uses 2x upgrade headroom by default", () => {
    // ProgramData metadata is 45 bytes; default max_len = 2 * programLen.
    expect(plan.programDataRent).toBe(rentExemptMinimum(45 + 2 * len));
    expect(plan.maxLenMultiplier).toBe(2);
  });

  it("program account and buffer rent match the loader sizes", () => {
    expect(plan.programAccountRent).toBe(rentExemptMinimum(36));
    expect(plan.bufferRent).toBe(rentExemptMinimum(37 + len));
  });

  it("honors a custom --max-len-mult", () => {
    const p = buildDeployPlan(fx("anchor"), { programLen: len, maxLenMultiplier: 1 });
    expect(p.programDataRent).toBe(rentExemptMinimum(45 + len));
  });

  it("write-tx count chunks the binary at ~1012 bytes", () => {
    expect(plan.writeTxCount).toBe(Math.ceil(len / 1012)); // = 2
  });

  it("wallet requirement = locked + transient buffer + fees", () => {
    expect(plan.lockedLamports).toBe(
      plan.programAccountRent + plan.programDataRent + plan.initRentLamports,
    );
    expect(plan.walletRequiredLamports).toBe(
      plan.lockedLamports + plan.bufferRent + plan.txFeeLamports,
    );
    // Steady-state lockup must be strictly less than the up-front requirement.
    expect(plan.lockedLamports).toBeLessThan(plan.walletRequiredLamports);
  });
});

describe("deploy-plan: ordered transaction sequence", () => {
  const plan = buildDeployPlan(fx("anchor"), { programLen: 1500 });

  it("emits create-buffer → write → deploy → initialize(s) in order", () => {
    const kinds = plan.steps.map((s) => s.kind);
    expect(kinds.slice(0, 3)).toEqual(["create-buffer", "write", "deploy"]);
    expect(kinds.slice(3)).toEqual(["initialize", "initialize"]);
    // indices are 1-based and contiguous
    expect(plan.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it("the deploy step locks program + programdata and refunds the buffer", () => {
    const deploy = plan.steps.find((s) => s.kind === "deploy")!;
    expect(deploy.rentLamports).toBe(plan.programAccountRent + plan.programDataRent);
    expect(deploy.transientLamports).toBe(-plan.bufferRent);
  });

  it("each initialize step maps to one Accounts struct", () => {
    const initSteps = plan.steps.filter((s) => s.kind === "initialize");
    expect(initSteps.map((s) => s.label)).toEqual([
      "Initialize: Initialize",
      "Initialize: InitConfig",
    ]);
  });
});

describe("deploy-plan: compiled binary discovery", () => {
  it("locates the .so under target/deploy and reads its byte length", () => {
    const bin = findProgramBinary(fx("with-binary"));
    expect(bin).not.toBeNull();
    expect(bin!.bytes).toBe(1500);
    expect(bin!.path.endsWith(".so")).toBe(true);
  });

  it("buildDeployPlan picks up the discovered binary length", () => {
    const plan = buildDeployPlan(fx("with-binary"));
    expect(plan.programLen).toBe(1500);
    expect(plan.binary).not.toBeNull();
  });
});

describe("deploy-plan: missing binary", () => {
  const plan = buildDeployPlan(fx("anchor")); // no target/deploy here

  it("zeroes program rent but still emits init steps", () => {
    expect(plan.programLen).toBeNull();
    expect(plan.programAccountRent).toBe(0);
    expect(plan.programDataRent).toBe(0);
    // structural sequence has no buffer/write/deploy, only the init steps
    expect(plan.steps.every((s) => s.kind === "initialize")).toBe(true);
    expect(plan.steps).toHaveLength(2);
  });

  it("markdown flags the missing build", () => {
    const md = renderDeployPlanMd(plan);
    expect(md).toContain("No compiled");
    expect(md).toContain("anchor build");
  });
});

describe("deploy-plan: non-literal space", () => {
  const plan = buildDeployPlan(fx("unresolved-space"), { programLen: 1000 });

  it("flags accounts whose space is not a literal and excludes them from totals", () => {
    const state = plan.initAccounts.find((a) => a.name === "state")!;
    expect(state.space).toBeNull();
    expect(state.spaceExpr).toContain("INIT_SPACE");
    expect(state.rentLamports).toBeNull();
    expect(plan.unresolvedInit).toHaveLength(1);
    expect(plan.initRentLamports).toBe(0);
  });

  it("markdown surfaces the unresolved-space warning", () => {
    const md = renderDeployPlanMd(plan);
    expect(md).toContain("non-literal expression");
  });
});

describe("deploy-plan: renderers", () => {
  const plan = buildDeployPlan(fx("anchor"), { programLen: 1500 });

  it("text renderer includes wallet funding line and sequence", () => {
    const txt = renderDeployPlanText(plan);
    expect(txt).toContain("Deployment Plan");
    expect(txt).toContain("fund wallet with");
    expect(txt).toContain("Initialize: Initialize");
  });

  it("markdown renderer includes the cost table and tx sequence", () => {
    const md = renderDeployPlanMd(plan);
    expect(md).toContain("How much SOL do I need?");
    expect(md).toContain("Exact transaction sequence");
    expect(md).toContain("Program data");
    expect(md).toContain("PDA seeds");
  });
});
