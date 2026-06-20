use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod fixed {
    use super::*;

    // FIXED: data_account is typed as Account<'info, MyData>.
    // Anchor automatically verifies: owner == program ID, and deserializes
    // the account data against the MyData discriminator.
    pub fn process(ctx: Context<Process>) -> Result<()> {
        let data = &ctx.accounts.data_account;
        msg!("Value: {}", data.value);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Process<'info> {
    pub signer: Signer<'info>,

    // FIXED: typed account — Anchor verifies owner and discriminator.
    #[account(mut)]
    pub data_account: Account<'info, MyData>,
}

#[account]
pub struct MyData {
    pub value: u64,
}
