use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

// A minimal Anchor program with two setup instructions that each create
// rent-paying accounts at initialization — the kind of deploy that
// `brainblast deploy-plan` reasons about: a treasury PDA + a config PDA.
#[program]
pub mod treasury_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.treasury.bump = ctx.bumps.treasury;
        ctx.accounts.treasury.authority = ctx.accounts.payer.key();
        Ok(())
    }

    pub fn init_config(ctx: Context<InitConfig>, fee_bps: u16) -> Result<()> {
        ctx.accounts.config.fee_bps = fee_bps;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // Treasury PDA: discriminator(8) + authority(32) + bump(1) = 41 bytes.
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1,
        seeds = [b"treasury", payer.key().as_ref()],
        bump
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    // Config PDA: discriminator(8) + fee_bps(2) = 10 bytes.
    #[account(
        init,
        payer = admin,
        space = 8 + 2,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Treasury {
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
pub struct Config {
    pub fee_bps: u16,
}
