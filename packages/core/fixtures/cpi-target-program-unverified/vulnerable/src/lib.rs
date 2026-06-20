use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

// VULNERABLE — the Wormhole ($325M, Feb 2022) class of bug.
//
// `token_program` is a raw AccountInfo with no address constraint, and the
// handler hands it straight to `invoke`. Anchor performs NO identity check on
// AccountInfo, so an attacker can pass their own program in this slot and the
// CPI will dispatch to attacker-controlled code with this program's authority.
#[program]
pub mod bridge {
    use super::*;

    pub fn forward(ctx: Context<Forward>, amount: u64) -> Result<()> {
        let ix = spl_transfer_ix(ctx.accounts.token_program.key, amount);
        // CPI to a program account that was never verified.
        invoke(
            &ix,
            &[
                ctx.accounts.source.clone(),
                ctx.accounts.destination.clone(),
                ctx.accounts.token_program.clone(),
            ],
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Forward<'info> {
    /// CHECK: source token account
    #[account(mut)]
    pub source: AccountInfo<'info>,
    /// CHECK: destination token account
    #[account(mut)]
    pub destination: AccountInfo<'info>,
    /// CHECK: VULNERABLE — unverified program target of the CPI below.
    pub token_program: AccountInfo<'info>,
}

fn spl_transfer_ix(_program: &Pubkey, _amount: u64) -> anchor_lang::solana_program::instruction::Instruction {
    unimplemented!()
}
