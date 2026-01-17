/**
 * Draft Claim Generator
 *
 * Builds draft claims from unattached payment-like attachment documents.
 */

import type { DetectedAmount, MedicalDocument } from "../types/medical-document.js";
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
 * Select the most reliable payment signal from detected amounts.
 */
function selectPrimaryPayment(
  detectedAmounts: DetectedAmount[]
): DraftClaimPayment | null {
  if (detectedAmounts.length === 0) return null;

  const best = detectedAmounts.reduce((current, candidate) => {
    if (!current) return candidate;
    if (candidate.confidence > current.confidence) return candidate;
    if (
      candidate.confidence === current.confidence &&
      candidate.value > current.value
    ) {
      return candidate;
    }
    return current;
  }, detectedAmounts[0]);

  return {
    amount: best.value,
    currency: best.currency,
    rawText: best.rawText,
    context: best.context,
    confidence: best.confidence,
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

  const candidates = documents.filter(
    (document) =>
      document.sourceType === "attachment" &&
      document.detectedAmounts.length > 0 &&
      !assignedDocumentIds.has(document.id) &&
      !draftDocumentIds.has(document.id) &&
      isWithinRange(document, range, now)
  );

  const createdDrafts: DraftClaim[] = [];

  for (const document of candidates) {
    const payment = selectPrimaryPayment(document.detectedAmounts);
    if (!payment) {
      continue;
    }

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
