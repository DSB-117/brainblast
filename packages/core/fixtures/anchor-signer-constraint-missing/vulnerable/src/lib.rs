use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod vulnerable {
    use super::*;

    // VULNERABLE: `authority` is typed as AccountInfo<'info> without a `signer`
    // constraint. Anchor performs no signing check on AccountInfo — any key can
    // be passed as the authority and the instruction will execute without ever
    // verifying that the caller actually owns (controls) that key.
    pub fn set_admin(ctx: Context<SetAdmin>, new_admin: Pubkey) -> Result<()> {
        ctx.accounts.config.admin = new_admin;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct SetAdmin<'info> {
    // FOOTGUN: AccountInfo<'info> with no `signer` constraint.
    // An attacker passes any pubkey as `authority` — no signature required.
    pub authority: AccountInfo<'info>,

    #[account(mut, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
}
