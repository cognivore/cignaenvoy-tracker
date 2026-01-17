/**
 * Draft Claims Storage
 *
 * JSON file storage for locally generated draft claims.
 */

import type {
  DraftClaim,
  DraftClaimStatus,
  CreateDraftClaimInput,
  UpdateDraftClaimInput,
} from "../types/draft-claim.js";
import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
} from "./base.js";

/**
 * Storage operations for draft claims.
 */
export const draftClaimsStorage = createStorage<DraftClaim>(
  STORAGE_DIRS.draftClaims,
  dateReviver
);

/**
 * Create a new draft claim record.
 */
export async function createDraftClaim(
  input: CreateDraftClaimInput
): Promise<DraftClaim> {
  const now = new Date();
  const draft: DraftClaim = {
    ...input,
    id: generateId(),
    generatedAt: now,
    updatedAt: now,
  };
  return draftClaimsStorage.save(draft);
}

/**
 * Update an existing draft claim.
 */
export async function updateDraftClaim(
  id: string,
  updates: UpdateDraftClaimInput
): Promise<DraftClaim | null> {
  const existing = await draftClaimsStorage.get(id);
  if (!existing) return null;

  const updated: DraftClaim = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };

  return draftClaimsStorage.save(updated);
}

/**
 * Get draft claims by status.
 */
export async function getDraftClaimsByStatus(
  status: DraftClaimStatus
): Promise<DraftClaim[]> {
  return draftClaimsStorage.find((d) => d.status === status);
}

/**
 * Get draft claim by primary document.
 */
export async function getDraftClaimByPrimaryDocument(
  primaryDocumentId: string
): Promise<DraftClaim | null> {
  const drafts = await draftClaimsStorage.find(
    (d) => d.primaryDocumentId === primaryDocumentId
  );
  return drafts[0] ?? null;
}

/**
 * Get draft claims for a specific document.
 */
export async function getDraftClaimsForDocument(
  documentId: string
): Promise<DraftClaim[]> {
  return draftClaimsStorage.find((d) => d.documentIds.includes(documentId));
}

/**
 * Check if a document is already attached to a draft claim.
 */
export async function hasDraftClaimForDocument(
  documentId: string
): Promise<boolean> {
  const drafts = await getDraftClaimsForDocument(documentId);
  return drafts.length > 0;
}
