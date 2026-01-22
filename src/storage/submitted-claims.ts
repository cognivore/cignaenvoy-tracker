/**
 * Submitted Claims Storage
 *
 * JSON file storage for claims submitted via Cigna Envoy automation.
 */

import type { Claim, CreateClaimInput, UpdateClaimInput } from "../types/claim.js";
import { createStorage, STORAGE_DIRS, generateId, dateReviver } from "./base.js";

/**
 * Storage operations for submitted claims.
 */
export const submittedClaimsStorage = createStorage<Claim>(
  STORAGE_DIRS.submittedClaims,
  dateReviver
);

/**
 * Create a new submitted claim record.
 */
export async function createSubmittedClaim(
  input: CreateClaimInput,
  status: Claim["status"] = "draft"
): Promise<Claim> {
  const now = new Date();
  const claim: Claim = {
    ...input,
    id: generateId(),
    status,
    createdAt: now,
    updatedAt: now,
  };
  return submittedClaimsStorage.save(claim);
}

/**
 * Update an existing submitted claim.
 */
export async function updateSubmittedClaim(
  id: string,
  updates: UpdateClaimInput
): Promise<Claim | null> {
  const existing = await submittedClaimsStorage.get(id);
  if (!existing) return null;

  const updated: Claim = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };
  return submittedClaimsStorage.save(updated);
}

/**
 * Archive a submitted claim.
 */
export async function archiveSubmittedClaim(id: string): Promise<Claim | null> {
  return updateSubmittedClaim(id, { archivedAt: new Date() });
}

/**
 * Unarchive a submitted claim.
 */
export async function unarchiveSubmittedClaim(id: string): Promise<Claim | null> {
  const existing = await submittedClaimsStorage.get(id);
  if (!existing) return null;

  const { archivedAt: _archivedAt, ...rest } = existing;
  const updated: Claim = { ...rest, updatedAt: new Date() };
  return submittedClaimsStorage.save(updated);
}

/**
 * Get submitted claims by status.
 */
export async function getSubmittedClaimsByStatus(
  status: Claim["status"]
): Promise<Claim[]> {
  return submittedClaimsStorage.find((claim) => claim.status === status);
}

/**
 * Get all archived submitted claims.
 */
export async function getArchivedSubmittedClaims(): Promise<Claim[]> {
  return submittedClaimsStorage.find((claim) => !!claim.archivedAt);
}

/**
 * Get all active submitted claims.
 */
export async function getActiveSubmittedClaims(): Promise<Claim[]> {
  return submittedClaimsStorage.find((claim) => !claim.archivedAt);
}
