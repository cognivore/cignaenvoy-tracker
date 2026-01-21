/**
 * Draft claim promotion service.
 *
 * Promotes a document (and its email group) into a draft claim,
 * even when no payment signal is present.
 */

import type { DraftClaim } from "../types/draft-claim.js";
import type { MedicalDocument } from "../types/medical-document.js";
import {
  createDraftClaim,
  draftClaimsStorage,
  updateDraftClaim,
} from "../storage/draft-claims.js";
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

function getGroupDocuments(
  selected: MedicalDocument,
  allDocuments: MedicalDocument[]
): MedicalDocument[] {
  if (selected.emailId && selected.sourceType !== "calendar") {
    const group = allDocuments.filter(
      (doc) =>
        !doc.archivedAt &&
        doc.emailId === selected.emailId &&
        doc.sourceType !== "calendar"
    );
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

export async function promoteDocumentToDraftClaim(
  selectedDocument: MedicalDocument,
  allDocuments: MedicalDocument[]
): Promise<PromoteDraftResult> {
  const drafts = await draftClaimsStorage.getAll();
  const activeDocuments = allDocuments.filter((doc) => !doc.archivedAt);
  const groupDocs = getGroupDocuments(selectedDocument, activeDocuments);
  const groupIds = dedupeIds(groupDocs.map((doc) => doc.id));

  const existing = drafts.find((draft) =>
    draft.documentIds.some((id) => groupIds.includes(id))
  );

  const { payment, primaryDocumentId } = buildGroupPayment(
    groupDocs,
    selectedDocument
  );
  const primaryDocument =
    groupDocs.find((doc) => doc.id === primaryDocumentId) ?? selectedDocument;
  const proofDocs = resolvePaymentProofDocuments({
    documents: activeDocuments,
    primaryDocument,
    payment,
  });
  const proofIds = dedupeIds(proofDocs.map((doc) => doc.id));

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

    const shouldUpdateDocuments =
      mergedDocumentIds.length !== existing.documentIds.length;
    const shouldUpdateProof =
      mergedProofIds.length !== (existing.paymentProofDocumentIds?.length ?? 0);

    if (shouldUpdateDocuments || shouldUpdateProof) {
      const updated = await updateDraftClaim(existing.id, {
        documentIds: mergedDocumentIds,
        ...(shouldUpdateProof && { paymentProofDocumentIds: mergedProofIds }),
      });
      return {
        draft: updated ?? existing,
        created: false,
        expanded: true,
      };
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
