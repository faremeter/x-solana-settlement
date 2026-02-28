import { logger } from "./logger";
import { type } from "arktype";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type {
  FacilitatorHandler,
  GetRequirementsArgs,
} from "@faremeter/types/facilitator";
import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
} from "@faremeter/types/x402v2";
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

function errorResponse(msg: string, network: string): x402SettleResponse {
  return {
    success: false,
    errorReason: msg,
    transaction: "",
    network,
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

  const getRequirements = async ({ accepts }: GetRequirementsArgs) => {
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    return accepts
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
    const tupleMatches = checkTuple(payment.accepted);

    if (isValidationError(tupleMatches)) {
      return null;
    }

    const paymentPayload = PaymentPayload(payment.payload);

    if (isValidationError(paymentPayload)) {
      return errorResponse(paymentPayload.summary, requirements.network);
    }

    const signature =
      paymentPayload.type == "transaction"
        ? await processTransaction(
            connection,
            paymentPayload.versionedTransaction,
          )
        : paymentPayload.transactionSignature;

    if (!signature) {
      return errorResponse("invalid signature", requirements.network);
    }

    logger.info(`Payment signature: ${signature}`);

    const transaction = await getTransaction(connection, signature);
    if (!transaction) {
      logger.info("could not retrieve transaction");
      return errorResponse(
        "could not retrieve transaction",
        requirements.network,
      );
    }

    const isValidTx = await isValidTransferTransaction(transaction);
    if (!isValidTx) {
      logger.info("invalid transaction");
      return errorResponse("invalid transaction", requirements.network);
    }

    const transactionData = await extractTransferData(transaction);
    if (!transactionData.success) {
      logger.info("couldn't extract transfer data");
      return errorResponse(
        "could not extract transfer data",
        requirements.network,
      );
    }

    const pubkey = await ed.getPublicKeyAsync(paymentPayload.sharedSecretKey);
    const isValidMemoSignature = await isValidMemo(
      transaction,
      pubkey,
      transactionData.data.amount.toString(),
    );

    if (!isValidMemoSignature) {
      logger.info("could not veify memo signature");
      return errorResponse(
        "could not verify memo signature",
        requirements.network,
      );
    }

    if (Number(transactionData.data.amount) !== Number(requirements.amount)) {
      logger.info("payments didn't match amount");
      return errorResponse(
        "payments didn't match amount",
        requirements.network,
      );
    }

    const settleTx = await createSettleTransaction(
      connection,
      adminKeypair,
      transactionData.payer,
      transactionData.data.nonce,
    );
    if (!settleTx) {
      logger.info("couldn't create settle tx");
      return errorResponse(
        "couldn't create settlement tx",
        requirements.network,
      );
    }

    const settleSig = await processTransaction(connection, settleTx);

    if (settleSig == null) {
      logger.info("couldn't process settlement");
      return errorResponse("couldn't process settlement", requirements.network);
    }

    return {
      success: true,
      transaction: settleSig,
      network: requirements.network,
      payer: paymentPayload.payer,
    };
  };

  return {
    getRequirements,
    handleSettle,
  };
};
