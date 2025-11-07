import { type } from "arktype";
import { isValidationError, throwValidationError, type Wallet } from "./types";
import { x402Scheme } from "./facilitator";
import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import type { x402PaymentRequirements } from "@faremeter/types/x402";
import type { RequestContext, PaymentExecer } from "@faremeter/types/client";

import { PaymentRequirementsExtra, createPaymentPayload } from "./types";
import {
  createMemoInstruction,
  createSolPaymentInstruction,
  createSplPaymentInstruction,
  type CreateSplPaymentInstructionOptions,
} from "./solana";
import * as ed from "@noble/ed25519";

async function sendTransaction(
  wallet: Wallet,
  sharedSecretKey: Uint8Array,
  instructions: TransactionInstruction[],
  recentBlockhash: string,
) {
  let tx: VersionedTransaction;

  if (wallet.buildTransaction) {
    tx = await wallet.buildTransaction(instructions, recentBlockhash);
  } else {
    const message = new TransactionMessage({
      instructions,
      payerKey: wallet.publicKey,
      recentBlockhash,
    }).compileToV0Message();

    tx = new VersionedTransaction(message);
  }

  let payload;

  if (wallet.updateTransaction) {
    tx = await wallet.updateTransaction(tx);
  }

  if (wallet.sendTransaction) {
    const hash = await wallet.sendTransaction(tx);
    payload = createPaymentPayload(
      wallet.publicKey,
      sharedSecretKey,
      undefined,
      hash,
    );
  } else {
    payload = createPaymentPayload(wallet.publicKey, sharedSecretKey, tx);
  }

  return {
    payload,
  };
}

export type CreatePaymentHandlerOptions = CreateSplPaymentInstructionOptions;

export function createPaymentHandler(
  wallet: Wallet,
  mint?: PublicKey,
  options?: CreatePaymentHandlerOptions,
) {
  const matcher = type({
    scheme: `'${x402Scheme}'`,
    network: `'${wallet.network}'`,
    asset: `'${mint ? mint.toBase58() : "sol"}'`,
  });

  return async (
    ctx: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecer[]> => {
    const res = accepts
      .filter((r) => !isValidationError(matcher(r)))
      .map((requirements) => {
        const extra = PaymentRequirementsExtra(requirements.extra);

        if (isValidationError(extra)) {
          throwValidationError(
            "couldn't validate requirements extra field",
            extra,
          );
        }

        const exec = async () => {
          const paymentRequirements = {
            ...extra,
            amount: Number(requirements.maxAmountRequired),
            receiver: new PublicKey(requirements.payTo),
            admin: new PublicKey(extra.admin),
          };

          const sharedSecretKey = ed.utils.randomPrivateKey();
          const message = Buffer.from(paymentRequirements.amount.toString());
          const signature = await ed.signAsync(message, sharedSecretKey);
          const signatureHex = Buffer.from(signature).toString("hex");

          const memoInstruction = createMemoInstruction(signatureHex);

          const instructions = [
            mint
              ? await createSplPaymentInstruction(
                  paymentRequirements,
                  mint,
                  wallet.publicKey,
                  options,
                )
              : await createSolPaymentInstruction(
                  paymentRequirements,
                  wallet.publicKey,
                ),
            memoInstruction,
          ];
          return await sendTransaction(
            wallet,
            sharedSecretKey,
            instructions,
            extra.recentBlockhash,
          );
        };

        return {
          exec,
          requirements,
        };
      });

    return res;
  };
}
