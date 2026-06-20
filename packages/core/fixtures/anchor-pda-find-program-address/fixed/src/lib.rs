use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod fixed {
    use super::*;

    // FIXED: PDA verification is handled entirely by the Anchor seeds + bump
    // constraint on the Accounts struct. No find_program_address call needed —
    // Anchor re-derives and verifies the PDA at account deserialization time,
    // using the canonical bump stored at init, at near-zero compute cost.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        ctx.accounts.vault.balance += amount;
        Ok(())
    }

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.vault.bump = ctx.bumps.vault;
        ctx.accounts.vault.balance = 0;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // FIXED: init with seeds + bump stores the canonical bump.
    #[account(
        init,
        payer = user,
        space = 8 + 1 + 8,
        seeds = [b"vault", user.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,

    // FIXED: seeds + bump constraint re-derives and verifies the PDA.
    // Uses the stored canonical bump — zero extra compute, guaranteed safe.
    #[account(
        mut,
        seeds = [b"vault", user.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

#[account]
pub struct Vault {
    pub bump: u8,
    pub balance: u64,
}
