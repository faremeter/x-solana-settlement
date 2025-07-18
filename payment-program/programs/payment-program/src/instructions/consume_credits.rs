use crate::{errors::PaymentError, state::CreditPurchase};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(original_payer: Pubkey, purchase_nonce: [u8; 32], credits_to_consume: u64)]
pub struct ConsumeCredits<'info> {
    #[account(
        mut,
        constraint = admin.key() == credit_purchase.admin @ PaymentError::Unauthorized
    )]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [
            CreditPurchase::SEED_PREFIX,
            purchase_nonce.as_ref(),
            original_payer.as_ref(),
        ],
        bump = credit_purchase.bump,
    )]
    pub credit_purchase: Account<'info, CreditPurchase>,
    /// CHECK: Anchor made me add this log
    pub original_payer_account: AccountInfo<'info>,
}

pub fn consume_credits_instruction(
    ctx: Context<ConsumeCredits>,
    _original_payer: Pubkey,
    _purchase_nonce: [u8; 32],
    credits_to_consume: u64,
) -> Result<()> {
    let credit_purchase = &mut ctx.accounts.credit_purchase;

    credit_purchase.consume_credits(credits_to_consume)?;

    msg!(
        "Consumed {} credits from purchase {}. Remaining: {}",
        credits_to_consume,
        credit_purchase.payer,
        credit_purchase.credits
    );

    if credit_purchase.is_depleted() {
        ctx.accounts
            .credit_purchase
            .close(ctx.accounts.original_payer_account.to_account_info())?;
    }

    Ok(())
}
