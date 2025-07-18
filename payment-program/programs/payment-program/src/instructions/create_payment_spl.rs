use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::state::Payment;

#[derive(Accounts)]
#[instruction(amount: u64, nonce: [u8; 32])]
pub struct CreatePaymentSPL<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The owner of the receiver token account
    pub receiver: AccountInfo<'info>,
    /// CHECK: The admin who will be able to settle this payment
    pub admin: AccountInfo<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = payer_token_account.owner == payer.key(),
        constraint = payer_token_account.mint == mint.key()
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = receiver_token_account.owner == receiver.key(),
        constraint = receiver_token_account.mint == mint.key()
    )]
    pub receiver_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        space = 8 + Payment::INIT_SPACE,
        payer = payer,
        seeds = [
            Payment::SEED_PREFIX,
            nonce.as_ref(),
            payer.key().as_ref(),
        ],
        bump,
    )]
    pub payment: Account<'info, Payment>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn create_payment_spl_instruction(
    ctx: Context<CreatePaymentSPL>,
    amount: u64,
    nonce: [u8; 32],
) -> Result<()> {
    *ctx.accounts.payment = Payment {
        amount,
        nonce,
        payer: ctx.accounts.payer.key(),
        admin: ctx.accounts.admin.key(),
        bump: ctx.bumps.payment,
    };

    let cpi_context = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        token::Transfer {
            from: ctx.accounts.payer_token_account.to_account_info(),
            to: ctx.accounts.receiver_token_account.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        },
    );

    token::transfer(cpi_context, amount)?;

    msg!(
        "SPL token payment created: {} tokens of mint {}",
        amount,
        ctx.accounts.mint.key()
    );
    Ok(())
}
