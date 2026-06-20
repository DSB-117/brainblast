use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod fixed {
    use super::*;

    // FIXED: authority is Signer<'info> — Anchor automatically verifies
    // the account signed the transaction before entering this handler.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(vault.balance >= amount, VaultError::InsufficientFunds);
        vault.balance -= amount;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    // FIXED: Signer<'info> enforces that this account signed the transaction.
    // Anchor rejects the instruction at account validation time if it did not.
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority)]
    pub vault: Account<'info, Vault>,
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub balance: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Insufficient funds")]
    InsufficientFunds,
}
