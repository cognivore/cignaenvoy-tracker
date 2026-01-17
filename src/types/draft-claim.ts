/**
 * Draft claim types.
 * Represents locally generated claims based on payment evidence.
 */

/**
 * Status of a draft claim in the workflow.
 */
export type DraftClaimStatus = "pending" | "accepted" | "rejected";

/** All draft claim statuses for iteration */
export const DRAFT_CLAIM_STATUSES: readonly DraftClaimStatus[] = [
  "pending",
  "accepted",
  "rejected",
] as const;

/**
 * Range filters for draft claim generation.
 */
export type DraftClaimRange = "forever" | "last_month" | "last_week";

/** All draft claim ranges for iteration */
export const DRAFT_CLAIM_RANGES: readonly DraftClaimRange[] = [
  "forever",
  "last_month",
  "last_week",
] as const;

/**
 * Source of the treatment date for a draft claim.
 */
export type DraftClaimDateSource = "calendar" | "manual" | "document";

/** All date sources for iteration */
export const DRAFT_CLAIM_DATE_SOURCES: readonly DraftClaimDateSource[] = [
  "calendar",
  "manual",
  "document",
] as const;

/**
 * Source of the payment amount for a draft claim.
 */
export type DraftClaimPaymentSource = "detected" | "override";

/** All payment sources for iteration */
export const DRAFT_CLAIM_PAYMENT_SOURCES: readonly DraftClaimPaymentSource[] = [
  "detected",
  "override",
] as const;

/**
 * Primary payment signal for a draft claim.
 */
export interface DraftClaimPayment {
  /** Amount detected or overridden */
  amount: number;

  /** Currency code (e.g., "EUR", "USD") */
  currency: string;

  /** Raw text that was parsed */
  rawText?: string;

  /** Context around the amount (surrounding text) */
  context?: string;

  /** Confidence score 0-100 */
  confidence?: number;

  /** Source of the payment signal */
  source?: DraftClaimPaymentSource;

  /** Override note (if payment came from manual override) */
  overrideNote?: string;

  /** Override update timestamp (if payment came from manual override) */
  overrideUpdatedAt?: Date;
}

/**
 * Draft claim generated from documents.
 */
export interface DraftClaim {
  /** Internal UUID for local tracking */
  id: string;

  /** Current status */
  status: DraftClaimStatus;

  /** Primary document that triggered the draft */
  primaryDocumentId: string;

  /** All documents attached to this draft (including calendar events) */
  documentIds: string[];

  /** Payment signal extracted from the primary document */
  payment: DraftClaimPayment;

  /** Illness associated with this draft (required for acceptance) */
  illnessId?: string;

  /** Doctor notes or context for the claim */
  doctorNotes?: string;

  /** Treatment date (required for acceptance) */
  treatmentDate?: Date;

  /** Source of the treatment date */
  treatmentDateSource?: DraftClaimDateSource;

  /** Calendar documents used to extract dates */
  calendarDocumentIds?: string[];

  /** Timestamp when draft was generated */
  generatedAt: Date;

  /** Timestamp when draft was last updated */
  updatedAt: Date;

  /** Timestamp when draft was accepted */
  acceptedAt?: Date;

  /** Timestamp when draft was rejected */
  rejectedAt?: Date;
}

/**
 * Input type for creating a new draft claim (without auto-generated fields).
 */
export type CreateDraftClaimInput = Omit<
  DraftClaim,
  "id" | "generatedAt" | "updatedAt" | "acceptedAt" | "rejectedAt"
>;

/**
 * Input type for updating existing draft claims.
 */
export type UpdateDraftClaimInput = Partial<
  Omit<DraftClaim, "id" | "generatedAt">
>;
