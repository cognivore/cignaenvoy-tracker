/**
 * Payment proof helpers.
 *
 * Best-effort matching for proof-of-payment documents (e.g. Monzo transfers).
 */

import type { DraftClaimPayment } from "../types/draft-claim.js";
import type { MedicalDocument } from "../types/medical-document.js";
import { getPaymentSignals } from "./payment-signal.js";

export const PAYMENT_PROOF_KEYWORDS = [
  "proof of payment",
  "payment received",
  "payment confirmation",
  "paid",
  "bank transfer",
  "transfer",
  "sent",
  "transaction",
  "monzo",
] as const;

const PAYMENT_PROOF_CLASSES = new Set(["receipt"]);
const DEFAULT_MAX_RESULTS = 3;
const DEFAULT_DATE_WINDOW_DAYS = 30;

function buildProofText(document: MedicalDocument): string {
  return [
    document.subject,
    document.bodySnippet,
    document.ocrText,
    document.filename,
    document.fromAddress,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasProofKeywords(text: string): boolean {
  return PAYMENT_PROOF_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isProofCandidate(document: MedicalDocument): boolean {
  if (document.archivedAt) return false;
  if (document.sourceType === "calendar") return false;
  if (PAYMENT_PROOF_CLASSES.has(document.classification)) return true;
  return hasProofKeywords(buildProofText(document));
}

function matchesPaymentAmount(
  document: MedicalDocument,
  payment: DraftClaimPayment
): boolean {
  if (!payment.amount || payment.amount <= 0) return false;
  const signals = getPaymentSignals(document);
  return signals.some(
    (signal) =>
      signal.currency === payment.currency &&
      Math.abs(signal.amount - payment.amount) < 0.01
  );
}

function getDocumentDate(document: MedicalDocument): Date | null {
  const date = document.date ?? document.processedAt;
  if (!date) return null;
  return new Date(date);
}

function isWithinDateWindow(
  reference: Date | null,
  candidate: Date | null,
  windowDays: number
): boolean {
  if (!reference || !candidate) return false;
  const diff = Math.abs(candidate.getTime() - reference.getTime());
  return diff <= windowDays * 24 * 60 * 60 * 1000;
}

export function resolvePaymentProofDocuments(params: {
  documents: MedicalDocument[];
  primaryDocument: MedicalDocument;
  payment: DraftClaimPayment;
  maxDocuments?: number;
}): MedicalDocument[] {
  const { documents, primaryDocument, payment, maxDocuments } = params;
  const limit = maxDocuments ?? DEFAULT_MAX_RESULTS;
  if (limit <= 0) return [];

  const referenceDate = getDocumentDate(primaryDocument);

  const scored = documents
    .filter((document) => document.id !== primaryDocument.id)
    .filter(isProofCandidate)
    .map((document) => {
      const text = buildProofText(document);
      const hasKeywords = hasProofKeywords(text);
      const isReceipt = PAYMENT_PROOF_CLASSES.has(document.classification);
      const amountMatch = matchesPaymentAmount(document, payment);
      const sameEmail =
        !!primaryDocument.emailId &&
        document.emailId === primaryDocument.emailId;
      const inWindow = isWithinDateWindow(
        referenceDate,
        getDocumentDate(document),
        DEFAULT_DATE_WINDOW_DAYS
      );

      const score =
        (amountMatch ? 4 : 0) +
        (isReceipt ? 2 : 0) +
        (hasKeywords ? 2 : 0) +
        (sameEmail ? 1 : 0) +
        (inWindow ? 1 : 0);

      return { document, score, amountMatch };
    })
    .filter((item) => item.score > 0);

  const preferred = scored.some((item) => item.amountMatch)
    ? scored.filter((item) => item.amountMatch)
    : scored;

  return preferred
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.document);
}
