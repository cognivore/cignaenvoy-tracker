/**
 * Draft Claim Generator
 *
 * Builds draft claims from unattached payment-like attachment documents.
 * Supports both detected amounts (OCR) and manual payment overrides.
 */

import type { MedicalDocument } from "../types/medical-document.js";
import type {
  DraftClaim,
  DraftClaimPayment,
  DraftClaimRange,
} from "../types/draft-claim.js";
import { documentsStorage } from "../storage/documents.js";
import { assignmentsStorage } from "../storage/assignments.js";
import {
  createDraftClaim,
  draftClaimsStorage,
} from "../storage/draft-claims.js";
import {
  getPrimaryPaymentSignal,
  hasPaymentSignal,
} from "./payment-signal.js";

/**
 * Determine if a document is within the requested date range.
 */
function isWithinRange(
  document: MedicalDocument,
  range: DraftClaimRange,
  now: Date
): boolean {
  if (range === "forever") return true;
  if (!document.date) return false;

  const days = range === "last_week" ? 7 : 30;
  const start = new Date(now);
  start.setDate(start.getDate() - days);

  const docDate = new Date(document.date);
  return docDate >= start && docDate <= now;
}

/**
 * Convert a payment signal into a draft claim payment snapshot.
 */
function toDraftClaimPayment(document: MedicalDocument): DraftClaimPayment | null {
  const signal = getPrimaryPaymentSignal(document);
  if (!signal) return null;

  return {
    amount: signal.amount,
    currency: signal.currency,
    rawText: signal.rawText,
    context: signal.context,
    confidence: signal.confidence,
    source: signal.source,
    overrideNote: signal.overrideNote,
    overrideUpdatedAt: signal.overrideUpdatedAt,
  };
}

/**
 * Generate draft claims from unattached payment documents.
 */
export async function generateDraftClaims(
  range: DraftClaimRange,
  now: Date = new Date()
): Promise<DraftClaim[]> {
  const [documents, assignments, existingDrafts] = await Promise.all([
    documentsStorage.getAll(),
    assignmentsStorage.getAll(),
    draftClaimsStorage.getAll(),
  ]);

  const assignedDocumentIds = new Set(
    assignments.map((assignment) => assignment.documentId)
  );

  const draftDocumentIds = new Set(
    existingDrafts.flatMap((draft) => draft.documentIds)
  );

  // Filter candidates: attachments with a payment signal, not already assigned or drafted
  const candidates = documents.filter(
    (document) =>
      document.sourceType === "attachment" &&
      hasPaymentSignal(document) &&
      !assignedDocumentIds.has(document.id) &&
      !draftDocumentIds.has(document.id) &&
      isWithinRange(document, range, now)
  );

  const createdDrafts: DraftClaim[] = [];

  for (const document of candidates) {
    const payment = toDraftClaimPayment(document);
    if (!payment) continue;

    const draft = await createDraftClaim({
      status: "pending",
      primaryDocumentId: document.id,
      documentIds: [document.id],
      payment,
    });

    createdDrafts.push(draft);
  }

  return createdDrafts;
}
