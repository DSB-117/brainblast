use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod vulnerable {
    use super::*;

    // VULNERABLE: calls find_program_address inside the handler body.
    // (1) Expensive: iterates bump seeds 255→0, up to 255 SHA256 hashes.
    // (2) Unsafe: if the canonical bump was stored at init time, re-deriving
    //     it here may silently use a different nonce than the one on-chain.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let (expected_vault, _bump) = Pubkey::find_program_address(
            &[b"vault", ctx.accounts.user.key().as_ref()],
            ctx.program_id,
        );
        require_keys_eq!(
            ctx.accounts.vault.key(),
            expected_vault,
            VaultError::InvalidVault
        );
        ctx.accounts.vault.balance += amount;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
}

#[account]
pub struct Vault {
    pub bump: u8,
    pub balance: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Invalid vault account")]
    InvalidVault,
}
