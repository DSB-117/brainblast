use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod vulnerable {
    use super::*;

    // VULNERABLE: data_account is UncheckedAccount — no ownership, data layout,
    // or signer validation is performed. An attacker can pass any account.
    pub fn process(ctx: Context<Process>) -> Result<()> {
        let data = &ctx.accounts.data_account;
        let raw = data.try_borrow_data()?;
        msg!("First byte: {}", raw[0]);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Process<'info> {
    pub signer: Signer<'info>,

    // FOOTGUN: UncheckedAccount performs no validation.
    // The /// CHECK comment satisfies the compiler but adds no on-chain safety.
    /// CHECK: this account is validated manually (but it isn't)
    pub data_account: UncheckedAccount<'info>,
}
