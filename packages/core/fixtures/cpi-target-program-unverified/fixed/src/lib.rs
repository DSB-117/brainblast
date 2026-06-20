use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_spl::token::Token;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqSvNVjEKKYm5FzCGVrSZd7");

// FIXED — `token_program` is typed `Program<'info, Token>`. Anchor verifies on
// deserialization that the supplied account's key equals the SPL Token program
// id, so a substituted program is rejected before `forward` ever runs. The CPI
// now provably targets the real program.
#[program]
pub mod bridge {
    use super::*;

    pub fn forward(ctx: Context<Forward>, amount: u64) -> Result<()> {
        let ix = spl_transfer_ix(ctx.accounts.token_program.key, amount);
        invoke(
            &ix,
            &[
                ctx.accounts.source.clone(),
                ctx.accounts.destination.clone(),
                ctx.accounts.token_program.to_account_info(),
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
    // FIXED: Program<'info, Token> — Anchor enforces the program id.
    pub token_program: Program<'info, Token>,
}

fn spl_transfer_ix(_program: &Pubkey, _amount: u64) -> anchor_lang::solana_program::instruction::Instruction {
    unimplemented!()
}
