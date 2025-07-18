use crate::state::CreditPurchase;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(amount: u64, nonce: [u8; 32], credits: u64)]
pub struct BuyCreditsSPL<'info> {
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
        space = 8 + CreditPurchase::INIT_SPACE,
        payer = payer,
        seeds = [
            CreditPurchase::SEED_PREFIX,
            nonce.as_ref(),
            payer.key().as_ref(),
        ],
        bump,
    )]
    pub credit_purchase: Account<'info, CreditPurchase>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn buy_credits_spl_instruction(
    ctx: Context<BuyCreditsSPL>,
    amount: u64,
    nonce: [u8; 32],
    credits: u64,
) -> Result<()> {
    *ctx.accounts.credit_purchase = CreditPurchase {
        amount,
        nonce,
        credits,
        payer: ctx.accounts.payer.key(),
        admin: ctx.accounts.admin.key(),
        bump: ctx.bumps.credit_purchase,
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
        "Credits purchased with SPL tokens: {} tokens of mint {} for {} credits",
        amount,
        ctx.accounts.mint.key(),
        credits
    );
    Ok(())
}
