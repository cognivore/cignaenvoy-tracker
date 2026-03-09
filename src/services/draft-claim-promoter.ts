/**
 * Draft claim promotion service.
 *
 * Promotes a document (and its email group) into a draft claim,
 * even when no payment signal is present.
 *
 * Performance: Checks for existing drafts BEFORE loading the full document
 * list. When the document already belongs to a draft and force=false this
 * returns immediately without any expensive I/O.
 */

import type { DraftClaim } from "../types/draft-claim.js";
import type { MedicalDocument } from "../types/medical-document.js";
import {
  createDraftClaim,
  draftClaimsStorage,
  getDraftClaimsForDocument,
  updateDraftClaim,
} from "../storage/draft-claims.js";
import {
  findActiveDocumentsByEmailId,
  documentsStorage,
} from "../storage/documents.js";
import {
  comparePaymentSignals,
  createEmptyPayment,
  toDraftClaimPayment,
} from "./draft-claim-payments.js";
import { getPrimaryPaymentSignal } from "./payment-signal.js";
import { dedupeIds } from "./ids.js";
import { resolvePaymentProofDocuments } from "./payment-proof.js";

const DEFAULT_CURRENCY = "EUR";
const EMPTY_PAYMENT_CONTEXT = "Manual promotion — no payment signal detected";

export interface PromoteDraftResult {
  draft: DraftClaim;
  created: boolean;
  expanded: boolean;
}

async function getGroupDocuments(
  selected: MedicalDocument
): Promise<MedicalDocument[]> {
  if (selected.emailId && selected.sourceType !== "calendar") {
    const group = await findActiveDocumentsByEmailId(selected.emailId);
    return group.length > 0 ? group : [selected];
  }
  return [selected];
}

function buildGroupPayment(
  documents: MedicalDocument[],
  fallbackDocument: MedicalDocument
): { payment: DraftClaim["payment"]; primaryDocumentId: string } {
  let best:
    | { signal: ReturnType<typeof getPrimaryPaymentSignal>; docId: string }
    | null = null;

  for (const document of documents) {
    const signal = getPrimaryPaymentSignal(document);
    if (!signal) continue;

    if (!best || comparePaymentSignals(signal, best.signal!) > 0) {
      best = { signal, docId: document.id };
    }
  }

  if (best?.signal) {
    return {
      payment: toDraftClaimPayment(best.signal),
      primaryDocumentId: best.docId,
    };
  }
  return {
    payment: createEmptyPayment(DEFAULT_CURRENCY, EMPTY_PAYMENT_CONTEXT),
    primaryDocumentId: fallbackDocument.id,
  };
}

/**
 * Promote a document into a draft claim.
 *
 * Fast path: checks existing drafts first (cheap). If a draft already exists
 * and force=false, returns immediately without loading any document lists.
 *
 * Slow path (new draft or force=true): loads only the email-thread group
 * via findActiveDocumentsByEmailId (indexed query) rather than all documents.
 */
export async function promoteDocumentToDraftClaim(
  selectedDocument: MedicalDocument,
  options?: { force?: boolean }
): Promise<PromoteDraftResult> {
  const force = options?.force ?? false;

  const drafts = await draftClaimsStorage.getAll();
  const existingByDocId = drafts.find((d) =>
    d.documentIds.includes(selectedDocument.id)
  );

  if (existingByDocId && !force) {
    // Fast path: draft exists. But if its payment is stale (€0.00),
    // reload the email group and try to find a real signal before
    // giving up. getGroupDocuments is an indexed query — cheap.
    if (existingByDocId.payment.amount === 0) {
      const groupDocs = await getGroupDocuments(selectedDocument);
      const { payment, primaryDocumentId } = buildGroupPayment(groupDocs, selectedDocument);
      if (payment.amount > 0) {
        const refreshed = await updateDraftClaim(existingByDocId.id, {
          payment,
          primaryDocumentId,
        });
        return { draft: refreshed ?? existingByDocId, created: false, expanded: true };
      }
    }
    return { draft: existingByDocId, created: false, expanded: false };
  }

  const groupDocs = await getGroupDocuments(selectedDocument);
  const groupIds = dedupeIds(groupDocs.map((d) => d.id));

  const existing =
    existingByDocId ??
    drafts.find((d) => d.documentIds.some((id) => groupIds.includes(id)));

  const { payment, primaryDocumentId } = buildGroupPayment(
    groupDocs,
    selectedDocument
  );
  const primaryDocument =
    groupDocs.find((d) => d.id === primaryDocumentId) ?? selectedDocument;
  const proofDocs = resolvePaymentProofDocuments({
    documents: groupDocs,
    primaryDocument,
    payment,
  });
  const proofIds = dedupeIds(proofDocs.map((d) => d.id));

  if (existing) {
    const mergedDocumentIds = dedupeIds([
      ...existing.documentIds,
      ...groupIds,
      ...proofIds,
    ]);
    const mergedProofIds = dedupeIds([
      ...(existing.paymentProofDocumentIds ?? []),
      ...proofIds,
    ]);

    if (force) {
      const updated = await updateDraftClaim(existing.id, {
        primaryDocumentId,
        documentIds: mergedDocumentIds,
        payment,
        paymentProofDocumentIds: mergedProofIds,
      });
      return { draft: updated ?? existing, created: false, expanded: true };
    }

    const shouldUpdateDocuments =
      mergedDocumentIds.length !== existing.documentIds.length;
    const shouldUpdateProof =
      mergedProofIds.length !== (existing.paymentProofDocumentIds?.length ?? 0);

    if (shouldUpdateDocuments || shouldUpdateProof) {
      const updated = await updateDraftClaim(existing.id, {
        documentIds: mergedDocumentIds,
        ...(shouldUpdateProof && { paymentProofDocumentIds: mergedProofIds }),
      });
      return { draft: updated ?? existing, created: false, expanded: true };
    }

    return { draft: existing, created: false, expanded: false };
  }

  const draft = await createDraftClaim({
    status: "pending",
    primaryDocumentId,
    documentIds: dedupeIds([...groupIds, ...proofIds]),
    payment,
    ...(proofIds.length > 0 && { paymentProofDocumentIds: proofIds }),
  });

  return { draft, created: true, expanded: false };
}

/**
 * Propagate a document's updated payment signal to all draft claims
 * that reference it.
 *
 * Called after reprocess or payment-override so that stale €0.00
 * snapshots created during early promotion get corrected.
 *
 * Only upgrades: a draft whose payment already has a real amount
 * is left untouched unless the new signal is strictly better
 * (higher priority source or higher confidence).
 */
export async function propagateDocumentPaymentToDrafts(
  documentId: string
): Promise<DraftClaim[]> {
  const drafts = await getDraftClaimsForDocument(documentId);
  if (drafts.length === 0) return [];

  const updated: DraftClaim[] = [];

  for (const draft of drafts) {
    const allDocs = await Promise.all(
      draft.documentIds.map((id) => documentsStorage.get(id))
    );
    const liveDocs = allDocs.filter(
      (d): d is MedicalDocument => d !== null && !d.archivedAt
    );

    const fallback = liveDocs.find((d) => d.id === draft.primaryDocumentId) ?? liveDocs[0];
    if (!fallback) continue;

    const { payment, primaryDocumentId } = buildGroupPayment(liveDocs, fallback);

    const improved =
      draft.payment.amount === 0 ||
      comparePaymentSignals(
        { ...payment, source: payment.source ?? "detected" },
        { ...draft.payment, source: draft.payment.source ?? "detected" }
      ) > 0;

    if (!improved) continue;

    const result = await updateDraftClaim(draft.id, {
      payment,
      primaryDocumentId,
    });
    if (result) updated.push(result);
  }

  return updated;
}
