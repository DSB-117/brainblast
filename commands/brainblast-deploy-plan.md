# /brainblast-deploy-plan

Deployment Intelligence for Anchor programs. Run before `anchor deploy` so you know **how much SOL you need** and the **exact ordered transaction sequence** — instead of working it out by hand.

Reads the compiled `.so` under `target/deploy/` and the program's `#[derive(Accounts)]` structs, then computes the on-chain BPF **upgradeable**-loader economics:

- **Program account** rent (`rent(36)`)
- **Program data** rent at the default 2× upgrade headroom (`rent(45 + 2·len)`) — the big, non-recoverable lockup
- **Buffer** rent (`rent(37 + len)`) — transient, refunded at deploy
- **Init account** rent for every `init` / `init_if_needed` PDA (treasury, config, …), with seeds + payer
- **Transaction fees** across create-buffer → write chunks → deploy → initialize

It prints a funding figure (safe upper bound on wallet balance) and the steady-state lockup, plus the step-by-step transaction plan.

## Usage

```
/brainblast-deploy-plan [dir] [--json] [--program-len BYTES] [--max-len-mult N] [--priority-fee MICROLAMPORTS]
```

```bash
npx brainblast deploy-plan $ARGUMENTS
```

- `--program-len BYTES` — model a build you haven't compiled yet (no `.so` needed).
- `--max-len-mult N` — override the 2× programdata upgrade headroom (`1` = no headroom).
- `--priority-fee MICROLAMPORTS` — note a priority fee on top of the base fees.
- `--json` — machine-readable plan for an agent to act on.

If no compiled `.so` is found, the structural transaction sequence is still produced — run `anchor build` first for exact rent figures. A markdown report is written to `.agent-research/deploy-plan.md`.
