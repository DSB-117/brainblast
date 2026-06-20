use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod vulnerable {
    use super::*;

    // VULNERABLE: authority is AccountInfo<'info> without a signer constraint.
    // Any account can be passed here — the instruction never checks that
    // the caller actually signed the transaction.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(vault.balance >= amount, VaultError::InsufficientFunds);
        vault.balance -= amount;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    // FOOTGUN: AccountInfo without signer constraint.
    // An attacker can pass any pubkey as authority — Anchor does not
    // verify it signed the transaction.
    #[account(mut, constraint = vault.authority == authority.key())]
    pub authority: AccountInfo<'info>,

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
