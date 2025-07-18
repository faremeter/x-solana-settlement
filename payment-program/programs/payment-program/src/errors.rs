use anchor_lang::error_code;

#[error_code]
pub enum PaymentError {
    #[msg("Unauthorized: Only admin can settle payments")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}
