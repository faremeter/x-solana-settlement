use anchor_lang::prelude::*;

use crate::errors::PaymentError;

#[account]
#[derive(InitSpace)]
pub struct Payment {
    pub amount: u64,
    pub nonce: [u8; 32],
    pub payer: Pubkey,
    pub admin: Pubkey,
    pub bump: u8,
}

impl Payment {
    pub const SEED_PREFIX: &'static [u8; 7] = b"payment";
}

#[account]
#[derive(InitSpace)]
pub struct CreditPurchase {
    pub amount: u64,
    pub nonce: [u8; 32],
    pub payer: Pubkey,
    pub admin: Pubkey,
    pub credits: u64,
    pub bump: u8,
}

impl CreditPurchase {
    pub const SEED_PREFIX: &'static [u8; 15] = b"credit_purchase";

    pub fn consume_credits(&mut self, amount: u64) -> Result<()> {
        // If we try to subtract more credits than are available, we set 0 remaining
        if amount > self.credits {
            self.credits = 0;
            return Ok(());
        }

        self.credits = self
            .credits
            .checked_sub(amount)
            .ok_or(PaymentError::ArithmeticOverflow)?;

        Ok(())
    }

    pub fn is_depleted(&self) -> bool {
        self.credits == 0
    }
}
