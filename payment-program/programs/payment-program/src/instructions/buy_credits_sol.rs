use crate::state::CreditPurchase;
use anchor_lang::{prelude::*, system_program};

#[derive(Accounts)]
#[instruction(payment_amount: u64, nonce: [u8; 32], credits: u64)]
pub struct BuyCredits<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    /// CHECK: anchor made me add this
    pub receiver: AccountInfo<'info>,
    /// CHECK: The admin who will be able to settle this payment
    pub admin: AccountInfo<'info>,
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
}

pub fn buy_credits_instruction(
    ctx: Context<BuyCredits>,
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
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.payer.to_account_info(),
            to: ctx.accounts.receiver.to_account_info(),
        },
    );

    system_program::transfer(cpi_context, amount)?;

    msg!("Credits purchased: {} SOL for {} credits", amount, credits);
    Ok(())
}
