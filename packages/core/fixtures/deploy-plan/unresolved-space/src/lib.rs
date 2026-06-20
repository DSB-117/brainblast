use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

#[program]
pub mod sized_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let _ = ctx;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // Non-literal space: references an associated const, so the exact byte
    // count can't be resolved statically.
    #[account(
        init,
        payer = payer,
        space = 8 + State::INIT_SPACE,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct State {
    pub data: Pubkey,
}
