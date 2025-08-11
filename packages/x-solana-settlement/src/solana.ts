import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  type TransactionSignature,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import type { CreatePaymentArgs, PaymentTargetInfo } from "./types";
import { BorshCoder, Program } from "@coral-xyz/anchor";
import { DummyProvider } from "./dummyprovider";
import type { PaymentProgram } from "./idl_type";
import { default as BN } from "bn.js";
import * as ed from "@noble/ed25519";

import paymentProgramInfo from "./payment_program.json";

import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

export const coder = new BorshCoder(paymentProgramInfo as PaymentProgram);

export const program = new Program(
  paymentProgramInfo as PaymentProgram,
  new DummyProvider(),
);

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export const getTransaction = async (
  connection: Connection,
  signature: TransactionSignature,
): Promise<VersionedTransactionResponse | null> => {
  const transaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!transaction || transaction.meta?.err) {
    return null;
  }

  return transaction;
};

export const processTransaction = async (
  connection: Connection,
  transaction: VersionedTransaction,
): Promise<string | null> => {
  try {
    const signature = await connection.sendTransaction(transaction);
    const { value } = await connection.confirmTransaction(
      signature,
      "confirmed",
    );

    return value.err ? null : signature;
  } catch (err) {
    console.log(err);
    return null;
  }
};

export const isValidTransferTransaction = async (
  transaction: VersionedTransactionResponse,
): Promise<boolean> => {
  const transferIndex =
    transaction.transaction.message.compiledInstructions.findIndex(
      (instruction) => {
        const programId =
          transaction.transaction.message.staticAccountKeys[
            instruction.programIdIndex
          ];

        if (programId === undefined) {
          return false;
        }
        return programId.equals(new PublicKey(paymentProgramInfo.address));
      },
    );

  if (transferIndex !== -1) {
    return true;
  }

  // Check inner instructions (CPIs)
  if (transaction.meta?.innerInstructions) {
    for (const innerInstructionSet of transaction.meta.innerInstructions) {
      const hasTransferInstruction = innerInstructionSet.instructions.some(
        (instruction) => {
          const programId =
            transaction.transaction.message.staticAccountKeys[
              instruction.programIdIndex
            ];
          if (programId === undefined) {
            return false;
          }
          return programId.equals(new PublicKey(paymentProgramInfo.address));
        },
      );
      if (hasTransferInstruction) {
        return true;
      }
    }
  }

  return false;
};

export const isValidMemo = async (
  transaction: VersionedTransactionResponse,
  expectedPublicKey: Uint8Array,
  originalMessage: string,
): Promise<boolean> => {
  const message = transaction.transaction.message;

  // Check top-level instructions for memo
  const memoIndex = message.compiledInstructions.findIndex((instruction) => {
    const programId = message.staticAccountKeys[instruction.programIdIndex];
    if (programId === undefined) {
      return false;
    }
    return programId.equals(MEMO_PROGRAM_ID);
  });

  let memoData: Uint8Array | null = null;

  if (memoIndex !== -1) {
    const memoInstruction = message.compiledInstructions[memoIndex];
    if (memoInstruction?.data) {
      memoData = memoInstruction.data;
    }
  }

  // Check inner instructions (CPIs) if not found in top-level
  if (!memoData && transaction.meta?.innerInstructions) {
    for (const innerInstructionSet of transaction.meta.innerInstructions) {
      for (const instruction of innerInstructionSet.instructions) {
        const programId = message.staticAccountKeys[instruction.programIdIndex];
        if (programId === undefined) {
          continue;
        }
        if (programId.equals(MEMO_PROGRAM_ID) && instruction.data) {
          // Inner instruction data is base58 encoded
          memoData = bs58.decode(instruction.data);
          break;
        }
      }
      if (memoData) break;
    }
  }

  if (!memoData) {
    return false;
  }

  const hexString = Buffer.from(memoData).toString("utf8");
  const signatureBytes = Buffer.from(hexString, "hex");

  const messageBuffer = Buffer.from(originalMessage);
  const isValid = await ed.verifyAsync(
    signatureBytes,
    messageBuffer,
    expectedPublicKey,
  );

  if (!isValid) {
    return false;
  }

  return true;
};

export const extractTransferData = async (
  transaction: VersionedTransactionResponse,
): Promise<
  | {
      success: true;
      payer: PublicKey;
      data: CreatePaymentArgs;
    }
  | {
      success: false;
      err: string;
    }
> => {
  const message = transaction.transaction.message;

  // Check top-level instructions
  const transferIndex = message.compiledInstructions.findIndex(
    (instruction) => {
      const programId = message.staticAccountKeys[instruction.programIdIndex];
      if (programId === undefined) {
        return false;
      }
      return programId.equals(new PublicKey(paymentProgramInfo.address));
    },
  );

  if (transferIndex !== -1) {
    const payerKeyIndex =
      message.compiledInstructions[transferIndex]?.accountKeyIndexes[0];
    if (payerKeyIndex === undefined) {
      return {
        success: false,
        err: "Could not find payer index",
      };
    }
    const payer = message.staticAccountKeys[payerKeyIndex];
    if (payer === undefined) {
      return {
        success: false,
        err: "Could not find payer",
      };
    }
    const transferData = message.compiledInstructions[transferIndex]?.data;
    if (transferData === undefined) {
      return {
        success: false,
        err: "Could not find transfer data",
      };
    }
    const decoded = coder.instruction.decode(Buffer.from(transferData));
    if (!decoded) {
      return {
        success: false,
        err: "Unable to decode data",
      };
    }
    const typedData = decoded.data as CreatePaymentArgs;
    return {
      success: true,
      payer,
      data: typedData,
    };
  }

  // Check inner instructions (CPIs)
  if (transaction.meta?.innerInstructions) {
    for (const innerInstructionSet of transaction.meta.innerInstructions) {
      for (const instruction of innerInstructionSet.instructions) {
        const programId = message.staticAccountKeys[instruction.programIdIndex];
        if (programId === undefined) {
          continue;
        }
        if (programId.equals(new PublicKey(paymentProgramInfo.address))) {
          const payerKeyIndex = instruction.accounts[0];
          if (payerKeyIndex === undefined) {
            return {
              success: false,
              err: "Could not find payer index in inner instruction",
            };
          }
          const payer = message.staticAccountKeys[payerKeyIndex];
          if (payer === undefined) {
            return {
              success: false,
              err: "Could not find payer in inner instruction",
            };
          }
          const transferData = instruction.data;
          if (transferData === undefined) {
            return {
              success: false,
              err: "Could not find transfer data in inner instruction",
            };
          }
          // Inner instruction data is base58 encoded for some reason
          const decoded = coder.instruction.decode(
            Buffer.from(bs58.decode(transferData)),
          );
          if (!decoded) {
            return {
              success: false,
              err: "Unable to decode data from inner instruction",
            };
          }
          const typedData = decoded.data as CreatePaymentArgs;
          return {
            success: true,
            payer,
            data: typedData,
          };
        }
      }
    }
  }

  return {
    success: false,
    err: "Transaction does not contain transfer instruction",
  };
};

export const createSolPaymentInstruction = async (
  target: PaymentTargetInfo,
  payer: PublicKey,
): Promise<TransactionInstruction> => {
  const nonce = crypto.getRandomValues(new Uint8Array(32));

  const [paymentAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), nonce, payer.toBuffer()],
    program.programId,
  );

  const createPayment = program.methods.createPaymentSol;

  if (createPayment === undefined) {
    throw new Error("couldn't find create payment instruction");
  }

  const programInstruction = await createPayment(
    new BN(target.amount),
    Array.from(nonce),
  )
    .accountsStrict({
      payer: payer,
      receiver: target.receiver,
      admin: target.admin,
      payment: paymentAccount,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return programInstruction;
};

export const createSettleTransaction = async (
  connection: Connection,
  settleAuthority: Keypair,
  payer: PublicKey,
  paymentNonce: number[],
): Promise<VersionedTransaction | null> => {
  if (paymentNonce.length !== 32) {
    return null;
  }

  console.log("Creating settle tx");

  const settleNonce = crypto.getRandomValues(new Uint8Array(32));

  const [paymentAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), Buffer.from(paymentNonce), payer.toBuffer()],
    program.programId,
  );

  const ixs = [];

  const settlePayment = program.methods.settlePayment;

  if (settlePayment === undefined) {
    throw new Error("couldn't find settle payment instruction");
  }

  const programInstruction = await settlePayment(
    payer,
    paymentNonce,
    Array.from(settleNonce),
  )
    .accountsStrict({
      admin: settleAuthority.publicKey,
      payment: paymentAccount,
      originalPayerAccount: payer,
    })
    .instruction();

  ixs.push(programInstruction);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    instructions: ixs,
    payerKey: settleAuthority.publicKey,
    recentBlockhash: blockhash,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([settleAuthority]);

  return tx;
};

export const createSplPaymentInstruction = async (
  target: PaymentTargetInfo,
  mint: PublicKey,
  payer: PublicKey,
): Promise<TransactionInstruction> => {
  const nonce = crypto.getRandomValues(new Uint8Array(32));

  const [paymentAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), nonce, payer.toBuffer()],
    program.programId,
  );

  const payerTokenAccount = getAssociatedTokenAddressSync(mint, payer);
  const receiverTokenAccount = getAssociatedTokenAddressSync(
    mint,
    target.receiver,
  );

  const createPaymentSpl = program.methods.createPaymentSpl;

  if (createPaymentSpl === undefined) {
    throw new Error("couldn't find create payment spl instruction");
  }

  const programInstruction = await createPaymentSpl(
    new BN(target.amount),
    Array.from(nonce),
  )
    .accountsStrict({
      payer: payer,
      receiver: target.receiver,
      admin: target.admin,
      mint: mint,
      payerTokenAccount: payerTokenAccount,
      receiverTokenAccount: receiverTokenAccount,
      payment: paymentAccount,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return programInstruction;
};

export const createMemoInstruction = (
  message: string,
): TransactionInstruction => {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(message, "utf8"),
  });
};
