// VULNERABLE: uses #[account(init_if_needed)] without a reinitialization guard.
// A second call to `initialize` with the same account will succeed and silently
// overwrite `counter.count` — full state-wipe with no on-chain recourse.
use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, start: u64) -> Result<()> {
        // No guard — any caller can reinitialize this account at any time.
        ctx.accounts.counter.count = start;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 8,
    )]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Counter {
    pub count: u64,
}
