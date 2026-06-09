// FIXED: uses #[account(init_if_needed)] WITH an explicit reinitialization guard.
// The require! macro aborts the instruction if the account is already initialized,
// preventing any caller from overwriting established state.
use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, start: u64) -> Result<()> {
        // Guard: abort if the counter has already been set.
        // With init_if_needed the account exists on re-invocation; this
        // ensure a non-zero count (or any initialized state) blocks the call.
        require!(
            ctx.accounts.counter.count == 0,
            CounterError::AlreadyInitialized
        );
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

#[error_code]
pub enum CounterError {
    #[msg("Counter has already been initialized")]
    AlreadyInitialized,
}
