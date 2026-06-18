use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vault_program {
    use super::*;

    // VULNERABLE: the IDL declares `authority` as isSigner, but the Accounts
    // struct below types it as a plain AccountInfo with no signer constraint.
    // Anyone can pass any account as the authority — a silent auth hole.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        ctx.accounts.vault.balance -= amount;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// CHECK: not constrained — this is the bug
    #[account(mut)]
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
}

#[account]
pub struct Vault {
    pub balance: u64,
}
