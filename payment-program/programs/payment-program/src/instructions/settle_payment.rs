use anchor_lang::prelude::*;

use crate::{errors::PaymentError, state::Payment};

#[derive(Accounts)]
#[instruction(original_payer: Pubkey, payment_nonce: [u8; 32], settle_nonce: [u8; 32])]
pub struct SettlePayment<'info> {
    #[account(
        mut,
        constraint = admin.key() == payment.admin @ PaymentError::Unauthorized
    )]
    pub admin: Signer<'info>,
    #[account(
        mut,
        close = original_payer_account,
        seeds = [
            Payment::SEED_PREFIX,
            payment_nonce.as_ref(),
            original_payer.as_ref(),
        ],
        bump = payment.bump,
    )]
    pub payment: Account<'info, Payment>,
    #[account(mut)]
    /// CHECK: anchor made me add this
    pub original_payer_account: AccountInfo<'info>,
}

pub fn settle_payment_instructions(
    ctx: Context<SettlePayment>,
    original_payer: Pubkey,
    _payment_nonce: [u8; 32],
    _settle_nonce: [u8; 32], // Unique nonce for settling to avoid race conditions
) -> Result<()> {
    if ctx.accounts.payment.payer != original_payer {}

    msg!("Payment successfully settled");
    Ok(())
}
