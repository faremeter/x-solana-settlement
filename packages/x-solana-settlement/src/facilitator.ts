import { logger } from "./logger";
import { type } from "arktype";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
} from "@faremeter/types/x402";
import { isValidationError, PaymentPayload } from "./types";

import {
  createSettleTransaction,
  extractTransferData,
  isValidTransferTransaction,
  processTransaction,
  isValidMemo,
  getTransaction,
} from "./solana";

import * as ed from "@noble/ed25519";

function errorResponse(msg: string): x402SettleResponse {
  return {
    success: false,
    error: msg,
    txHash: null,
    networkId: null,
  };
}

export const x402Scheme = "@faremeter/x-solana-settlement";

export const createFacilitatorHandler = (
  network: string,
  connection: Connection,
  adminKeypair: Keypair,
  mint?: PublicKey,
): FacilitatorHandler => {
  const checkTuple = type({
    scheme: `'${x402Scheme}'`,
    network: `'${network}'`,
  });

  const asset = mint ? mint.toBase58() : "sol";
  const checkTupleAndAsset = checkTuple.and({ asset: `'${asset}'` });

  const getRequirements = async (req: x402PaymentRequirements[]) => {
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    return req
      .filter((x) => !isValidationError(checkTupleAndAsset(x)))
      .map((x) => {
        return {
          ...x,
          asset: mint ? mint.toBase58() : "sol",
          extra: {
            admin: adminKeypair.publicKey.toString(),
            recentBlockhash,
          },
        };
      });
  };

  const handleSettle = async (
    requirements: x402PaymentRequirements,
    payment: x402PaymentPayload,
  ) => {
    const tupleMatches = checkTuple(payment);

    if (isValidationError(tupleMatches)) {
      return null;
    }

    const paymentPayload = PaymentPayload(payment.payload);

    if (isValidationError(paymentPayload)) {
      return errorResponse(paymentPayload.summary);
    }

    const signature =
      paymentPayload.type == "transaction"
        ? await processTransaction(
            connection,
            paymentPayload.versionedTransaction,
          )
        : paymentPayload.transactionSignature;

    if (!signature) {
      return errorResponse("invalid signature");
    }

    logger.info(`Payment signature: ${signature}`);

    const transaction = await getTransaction(connection, signature);
    if (!transaction) {
      logger.info("could not retrieve transaction");
      return errorResponse("could not retrieve transaction");
    }

    const isValidTx = await isValidTransferTransaction(transaction);
    if (!isValidTx) {
      logger.info("invalid transaction");
      return errorResponse("invalid transaction");
    }

    const transactionData = await extractTransferData(transaction);
    if (!transactionData.success) {
      logger.info("couldn't extract transfer data");
      return errorResponse("could not extract transfer data");
    }

    const pubkey = await ed.getPublicKeyAsync(paymentPayload.sharedSecretKey);
    const isValidMemoSignature = await isValidMemo(
      transaction,
      pubkey,
      transactionData.data.amount.toString(),
    );

    if (!isValidMemoSignature) {
      logger.info("could not veify memo signature");
      return errorResponse("could not verify memo signature");
    }

    if (
      Number(transactionData.data.amount) !==
      Number(requirements.maxAmountRequired)
    ) {
      logger.info("payments didn't match amount");
      return errorResponse("payments didn't match amount");
    }

    const settleTx = await createSettleTransaction(
      connection,
      adminKeypair,
      transactionData.payer,
      transactionData.data.nonce,
    );
    if (!settleTx) {
      logger.info("couldn't create settle tx");
      return errorResponse("couldn't create settlement tx");
    }

    const settleSig = await processTransaction(connection, settleTx);

    if (settleSig == null) {
      logger.info("couldn't process settlement");
      return errorResponse("couldn't process settlement");
    }

    return {
      success: true,
      error: null,
      txHash: settleSig,
      networkId: payment.network,
    };
  };

  return {
    getRequirements,
    handleSettle,
  };
};
