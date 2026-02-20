/**
 * Draft Claim Generator
 *
 * Builds draft claims from unattached payment-like attachment documents.
 * Supports both detected amounts (OCR) and manual payment overrides.
 */

import type { MedicalDocument } from "../types/medical-document.js";
import type { DraftClaim, DraftClaimRange } from "../types/draft-claim.js";
import { getActiveDocuments } from "../storage/documents.js";
import { assignmentsStorage } from "../storage/assignments.js";
import {
    createDraftClaim,
    draftClaimsStorage,
} from "../storage/draft-claims.js";
import {
    getPrimaryPaymentSignal,
    hasPaymentSignal,
} from "./payment-signal.js";
import { toDraftClaimPayment } from "./draft-claim-payments.js";
import { dedupeIds } from "./ids.js";
import { resolvePaymentProofDocuments } from "./payment-proof.js";

/**
 * Get all documents from the same email thread as the primary document.
 * Excludes calendar documents and archived documents.
 */
function getEmailThreadDocuments(
    primaryDocument: MedicalDocument,
    allDocuments: MedicalDocument[]
): MedicalDocument[] {
    const emailId = primaryDocument.emailId;
    if (!emailId) return [primaryDocument];

    return allDocuments.filter(
        (doc) =>
            !doc.archivedAt &&
            doc.emailId === emailId &&
            doc.sourceType !== "calendar"
    );
}

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
 * Convert a document's primary payment signal into a draft claim payment snapshot.
 */
function buildDraftPayment(document: MedicalDocument) {
    const signal = getPrimaryPaymentSignal(document);
    if (!signal) return null;
    return toDraftClaimPayment(signal);
}

/**
 * Generate draft claims from unattached payment documents.
 */
export async function generateDraftClaims(
    range: DraftClaimRange,
    now: Date = new Date()
): Promise<DraftClaim[]> {
    const [documents, assignments, existingDrafts] = await Promise.all([
        getActiveDocuments(),
        assignmentsStorage.getAll(),
        draftClaimsStorage.getAll(),
    ]);

    const assignedDocumentIds = new Set(
        assignments.map((assignment) => assignment.documentId)
    );

    const draftDocumentIds = new Set(
        existingDrafts.flatMap((draft) => draft.documentIds)
    );

    const billLikeClasses = new Set(["medical_bill", "receipt"]);

    // Filter candidates: attachments with a payment signal, not already assigned or drafted
    const candidates = documents.filter(
        (document) =>
            document.sourceType === "attachment" &&
            !document.archivedAt &&
            billLikeClasses.has(document.classification) &&
            hasPaymentSignal(document) &&
            !assignedDocumentIds.has(document.id) &&
            !draftDocumentIds.has(document.id) &&
            isWithinRange(document, range, now)
    );

    const createdDrafts: DraftClaim[] = [];

    for (const document of candidates) {
        const payment = buildDraftPayment(document);
        if (!payment) continue;

        // Get all documents from the same email thread
        const threadDocs = getEmailThreadDocuments(document, documents);
        const threadIds = threadDocs.map((doc) => doc.id);

        // Resolve payment proofs (also restricted to same thread)
        const proofDocs = resolvePaymentProofDocuments({
            documents,
            primaryDocument: document,
            payment,
        });
        const proofIds = proofDocs.map((doc) => doc.id);

        // Combine: primary + thread docs + proof docs (deduplicated)
        const documentIds = dedupeIds([document.id, ...threadIds, ...proofIds]);

        const draft = await createDraftClaim({
            status: "pending",
            primaryDocumentId: document.id,
            documentIds,
            payment,
            ...(proofIds.length > 0 && { paymentProofDocumentIds: proofIds }),
        });

        createdDrafts.push(draft);
    }

    return createdDrafts;
}
