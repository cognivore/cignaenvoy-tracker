/**
 * Draft claim payment helpers.
 *
 * Keeps payment mapping consistent across draft claim creation paths.
 */

import type { DraftClaimPayment } from "../types/draft-claim.js";
import type { PaymentSignal, PaymentSignalSource } from "./payment-signal.js";

const SIGNAL_PRIORITY: Record<PaymentSignalSource, number> = {
  override: 2,
  detected: 1,
};

export function comparePaymentSignals(
  a: PaymentSignal,
  b: PaymentSignal
): number {
  if (a.source !== b.source) {
    return SIGNAL_PRIORITY[a.source] - SIGNAL_PRIORITY[b.source];
  }

  const aConfidence = a.confidence ?? 0;
  const bConfidence = b.confidence ?? 0;
  if (aConfidence !== bConfidence) return aConfidence - bConfidence;

  if (a.amount !== b.amount) return a.amount - b.amount;
  return 0;
}

export function toDraftClaimPayment(
  signal: PaymentSignal
): DraftClaimPayment {
  const payment: DraftClaimPayment = {
    amount: signal.amount,
    currency: signal.currency,
    source: signal.source,
  };

  if (signal.confidence !== undefined) {
    payment.confidence = signal.confidence;
  }
  if (signal.rawText !== undefined) {
    payment.rawText = signal.rawText;
  }
  if (signal.context !== undefined) {
    payment.context = signal.context;
  }
  if (signal.overrideNote !== undefined) {
    payment.overrideNote = signal.overrideNote;
  }
  if (signal.overrideUpdatedAt !== undefined) {
    payment.overrideUpdatedAt = signal.overrideUpdatedAt;
  }

  return payment;
}

export function createEmptyPayment(
  currency: string,
  context?: string
): DraftClaimPayment {
  const payment: DraftClaimPayment = {
    amount: 0,
    currency,
  };

  if (context) {
    payment.context = context;
  }

  return payment;
}
