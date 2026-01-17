/**
 * Document-Claim Assignments Storage
 *
 * JSON file storage for document-to-claim assignments.
 */

import type {
  DocumentClaimAssignment,
  CreateAssignmentInput,
  UpdateAssignmentInput,
  AssignmentStatus,
} from "../types/assignment.js";
import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
} from "./base.js";

/**
 * Storage operations for assignments.
 */
export const assignmentsStorage = createStorage<DocumentClaimAssignment>(
  STORAGE_DIRS.assignments,
  dateReviver
);

/**
 * Create a new assignment (candidate).
 */
export async function createAssignment(
  input: CreateAssignmentInput
): Promise<DocumentClaimAssignment> {
  const assignment: DocumentClaimAssignment = {
    ...input,
    id: generateId(),
    status: "candidate",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return assignmentsStorage.save(assignment);
}

/**
 * Extended update input that includes illnessId for confirmations.
 */
export interface ExtendedUpdateInput extends UpdateAssignmentInput {
  /** Illness ID - required for confirmation */
  illnessId?: string;
}

/**
 * Update an assignment (confirm/reject).
 */
export async function updateAssignment(
  id: string,
  updates: ExtendedUpdateInput,
  confirmedBy?: string
): Promise<DocumentClaimAssignment | null> {
  const existing = await assignmentsStorage.get(id);
  if (!existing) return null;

  const now = new Date();
  const updated: DocumentClaimAssignment = {
    ...existing,
    ...updates,
    updatedAt: now,
  };

  // Set confirmed fields if confirming
  if (updates.status === "confirmed") {
    updated.confirmedAt = now;
    if (confirmedBy) {
      updated.confirmedBy = confirmedBy;
    }
  }

  return assignmentsStorage.save(updated);
}

/**
 * Confirm an assignment.
 * Requires illnessId to link the evidence to a specific illness.
 */
export async function confirmAssignment(
  id: string,
  illnessId: string,
  confirmedBy?: string,
  reviewNotes?: string
): Promise<DocumentClaimAssignment | null> {
  if (!illnessId) {
    throw new Error("illnessId is required to confirm an assignment");
  }

  return updateAssignment(
    id,
    { status: "confirmed", illnessId, ...(reviewNotes && { reviewNotes }) },
    confirmedBy
  );
}

/**
 * Reject an assignment.
 */
export async function rejectAssignment(
  id: string,
  reviewNotes?: string
): Promise<DocumentClaimAssignment | null> {
  return updateAssignment(id, { status: "rejected", ...(reviewNotes && { reviewNotes }) });
}

/**
 * Get assignments by status.
 */
export async function getAssignmentsByStatus(
  status: AssignmentStatus
): Promise<DocumentClaimAssignment[]> {
  return assignmentsStorage.find((a) => a.status === status);
}

/**
 * Get candidate assignments (pending human review).
 */
export async function getCandidateAssignments(): Promise<
  DocumentClaimAssignment[]
> {
  return getAssignmentsByStatus("candidate");
}

/**
 * Get confirmed assignments.
 */
export async function getConfirmedAssignments(): Promise<
  DocumentClaimAssignment[]
> {
  return getAssignmentsByStatus("confirmed");
}

/**
 * Get assignments for a specific document.
 */
export async function getAssignmentsForDocument(
  documentId: string
): Promise<DocumentClaimAssignment[]> {
  return assignmentsStorage.find((a) => a.documentId === documentId);
}

/**
 * Get assignments for a specific claim.
 */
export async function getAssignmentsForClaim(
  claimId: string
): Promise<DocumentClaimAssignment[]> {
  return assignmentsStorage.find((a) => a.claimId === claimId);
}

/**
 * Check if a document has any confirmed assignment.
 */
export async function hasConfirmedAssignment(
  documentId: string
): Promise<boolean> {
  const assignments = await assignmentsStorage.find(
    (a) => a.documentId === documentId && a.status === "confirmed"
  );
  return assignments.length > 0;
}

/**
 * Get assignment by document and claim pair.
 */
export async function getAssignmentByPair(
  documentId: string,
  claimId: string
): Promise<DocumentClaimAssignment | null> {
  const assignments = await assignmentsStorage.find(
    (a) => a.documentId === documentId && a.claimId === claimId
  );
  return assignments[0] ?? null;
}

/**
 * Delete all candidate assignments for a document.
 * Useful when re-running matching.
 */
export async function clearCandidatesForDocument(
  documentId: string
): Promise<number> {
  const candidates = await assignmentsStorage.find(
    (a) => a.documentId === documentId && a.status === "candidate"
  );

  let deleted = 0;
  for (const candidate of candidates) {
    const success = await assignmentsStorage.delete(candidate.id);
    if (success) deleted++;
  }

  return deleted;
}

/**
 * Get assignment statistics.
 */
export async function getAssignmentStats(): Promise<{
  total: number;
  candidates: number;
  confirmed: number;
  rejected: number;
  avgMatchScore: number;
}> {
  const all = await assignmentsStorage.getAll();

  const stats = {
    total: all.length,
    candidates: 0,
    confirmed: 0,
    rejected: 0,
    avgMatchScore: 0,
  };

  let totalScore = 0;
  for (const a of all) {
    switch (a.status) {
      case "candidate":
        stats.candidates++;
        break;
      case "confirmed":
        stats.confirmed++;
        break;
      case "rejected":
        stats.rejected++;
        break;
    }
    totalScore += a.matchScore;
  }

  stats.avgMatchScore = all.length > 0 ? totalScore / all.length : 0;

  return stats;
}

/**
 * Get high-confidence candidates (above threshold).
 */
export async function getHighConfidenceCandidates(
  minScore: number = 70
): Promise<DocumentClaimAssignment[]> {
  return assignmentsStorage.find(
    (a) => a.status === "candidate" && a.matchScore >= minScore
  );
}
