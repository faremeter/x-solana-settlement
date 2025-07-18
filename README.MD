# Solana Payment-Gated API System

## Concept

This system creates a **Solana program** that manages micropayments for API access. Here's how it works:

1. **Payment Creation**: When a user wants to access a protected endpoint, they create a payment transaction that:
   - Transfers SOL to the API provider
   - Creates a **Payment account** (PDA) that stores payment metadata
   - Uses a unique nonce to prevent duplicate payments

2. **Settlement with Race Condition Protection**: When the server processes the payment, it immediately settles it using an admin transaction that:
   - **Uses a unique settle nonce** - this is crucial for preventing race conditions
   - Multiple settlement attempts will fail because only one can successfully close the account
   - **Returns the rent** from the Payment account back to the original payer
   - Ensures each payment can only be settled once

3. **Rent Recovery**: The Payment account requires rent (~0.002 SOL) to exist on-chain. When settled, this rent is automatically returned to the original payer, so they only pay the actual service fee.

## 🔒 Race Condition Prevention

The **settle nonce** is key to preventing race conditions:

```rust
// Each settlement transaction uses a unique nonce
pub fn settle_payment(
    ctx: Context<SettlePayment>,
    original_payer: Pubkey,
    payment_nonce: [u8; 32],  // Original payment nonce
    settle_nonce: [u8; 32],   // UNIQUE settle nonce - prevents race
) -> Result<()>
```

Example createPayment tx: https://solscan.io/tx/4F1kPoz3L6JqWcUM53cGMZjvYb41TuzqZbAXrXDYQmF6HWNQB2M9WFBbXzdE56GFCNudieAKH5tfJzk6u51EMUF?cluster=devnet

Example settlePayment tx: https://solscan.io/tx/3UZNTyG7QsceTCBmJmTHE8Fiah6TeJpzopKzCcLNciXHrtTKUrZQub9322AWBuuxba2q1zsN4NXp6Pja6podNfrH?cluster=devnet