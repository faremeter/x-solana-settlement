import {
  PublicKey,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { default as BN } from "bn.js";
import { type } from "arktype";
import bs58 from "bs58";

const base58DecodeString = type("string").pipe.try((t) => {
  return bs58.decode(t);
});

const VersionedTransactionString = type("string")
  .pipe(base58DecodeString)
  .pipe.try((tx) => {
    return VersionedTransaction.deserialize(tx);
  });

export const PaymentPayload = type({
  payer: "string",
  sharedSecretKey: base58DecodeString,
}).and(
  type({
    type: "'transaction'",
    versionedTransaction: VersionedTransactionString,
  }).or({
    type: "'signature'",
    transactionSignature: "string",
  }),
);

export type PaymentPayload = typeof PaymentPayload.infer;

export function createPaymentPayload(
  payer: PublicKey,
  sharedSecretKey: Uint8Array,
  versionedTransaction?: VersionedTransaction,
  transactionSignature?: string,
) {
  if (versionedTransaction && transactionSignature) {
    throw Error("Cannot pass both transaction and signature");
  }

  const payerB58 = payer.toBase58();
  const sharedSecretKeyString = bs58.encode(sharedSecretKey);

  if (versionedTransaction) {
    const versionedTransactionB58 = bs58.encode(
      versionedTransaction.serialize(),
    );

    return {
      type: "transaction",
      sharedSecretKey: sharedSecretKeyString,
      versionedTransaction: versionedTransactionB58,
      payer: payerB58,
    };
  } else {
    return {
      type: "signature",
      sharedSecretKey: sharedSecretKeyString,
      transactionSignature,
      payer: payerB58,
    };
  }
}

export interface PaymentTargetInfo {
  receiver: PublicKey;
  admin: PublicKey;
  amount: number;
  recentBlockhash: string;
}

export interface CreatePaymentArgs {
  amount: BN;
  nonce: number[];
}

export const PaymentRequirementsExtra = type({
  admin: "string",
  recentBlockhash: "string",
});

export type PaymentRequirementsExtra = typeof PaymentRequirementsExtra.infer;

export type Wallet = {
  network: string;
  publicKey: PublicKey;
  buildTransaction?: (
    instructions: TransactionInstruction[],
    recentBlockHash: string,
  ) => Promise<VersionedTransaction>;
  updateTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  sendTransaction?: (tx: VersionedTransaction) => Promise<string>;
};
