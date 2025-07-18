use anchor_lang::{prelude::*, system_program};

use crate::state::Payment;

#[derive(Accounts)]
#[instruction(payment_amount: u64, nonce: [u8; 32])]
pub struct CreatePayment<'info> {
    #[account(mut)]
    payer: Signer<'info>,
    #[account(mut)]
    /// CHECK: anchor made me add this
    receiver: AccountInfo<'info>,
    /// CHECK: The admin who will be able to settle this payment
    admin: AccountInfo<'info>,

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
    payment: Account<'info, Payment>,
    system_program: Program<'info, System>,
}

pub fn create_payment_instruction(
    ctx: Context<CreatePayment>,
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
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.payer.to_account_info(),
            to: ctx.accounts.receiver.to_account_info(),
        },
    );

    system_program::transfer(cpi_context, amount)?;

    Ok(())
}
