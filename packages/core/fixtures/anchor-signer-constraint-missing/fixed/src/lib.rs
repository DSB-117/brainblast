use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod fixed {
    use super::*;

    // FIXED: `authority` is typed as Signer<'info>. Anchor verifies at account
    // deserialization that the transaction was signed by this key — no explicit
    // runtime check required in the handler body.
    pub fn set_admin(ctx: Context<SetAdmin>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.config.admin = new_admin;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct SetAdmin<'info> {
    // FIXED: Signer<'info> enforces that the transaction includes a valid
    // signature from this key. Unsigned calls are rejected before the handler runs.
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority)]
    pub config: Account<'info, Config>,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
}
