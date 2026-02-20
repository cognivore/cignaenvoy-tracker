/**
 * Draft claim types.
 * Represents locally generated claims based on payment evidence.
 */

import type { ClaimType, Symptom } from "./claim.js";

/**
 * Status of a draft claim in the workflow.
 */
export type DraftClaimStatus = "pending" | "accepted" | "rejected" | "submitted";

/** All draft claim statuses for iteration */
export const DRAFT_CLAIM_STATUSES: readonly DraftClaimStatus[] = [
  "pending",
  "accepted",
  "rejected",
  "submitted",
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
 * Submission details needed to file a claim in Cigna.
 */
export interface DraftClaimSubmission {
  /** Claim type (Medical, Vision, Dental) */
  claimType?: ClaimType;

  /** Country where care was received */
  country?: string;

  /** Symptoms/diagnoses (up to 3) */
  symptoms?: Symptom[];

  /** Provider name or clinic */
  providerName?: string;

  /** Provider address */
  providerAddress?: string;

  /** Provider country */
  providerCountry?: string;

  /** Progress report / doctor notes */
  progressReport?: string;
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

  /** Proof-of-payment documents (e.g., bank transfer receipts) */
  paymentProofDocumentIds?: string[];

  /** Manual proof-of-payment text supplied by the user */
  paymentProofText?: string;

  /** Submission details captured before sending to Cigna */
  submission?: DraftClaimSubmission;

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

  // ========== CIGNA SUBMISSION LINK ==========
  // These fields establish the definitive link between a DraftClaim and
  // the corresponding ScrapedClaim after submission to Cigna Envoy.

  /**
   * Cigna submission number (e.g., "37603507").
   * This is the PRIMARY key for matching - when present, it provides
   * a guaranteed match to the corresponding ScrapedClaim.
   */
  submissionNumber?: string;

  /**
   * Reference to the linked ScrapedClaim.id after match confirmation.
   * Set when match is accepted (either automatically or manually).
   */
  scrapedClaimId?: string;

  /**
   * Cigna claim number (e.g., "82143450").
   * May not be available immediately (claims show "Claim number will be generated soon").
   */
  cignaClaimNumber?: string;

  /**
   * Timestamp when the link to scraped claim was established.
   */
  linkedAt?: Date;

  // ========== TIMESTAMPS ==========

  /** Timestamp when draft was generated */
  generatedAt: Date;

  /** Timestamp when draft was last updated */
  updatedAt: Date;

  /** Timestamp when draft was accepted */
  acceptedAt?: Date;

  /** Timestamp when draft was rejected */
  rejectedAt?: Date;

  /** Timestamp when draft was archived (if archived) */
  archivedAt?: Date;
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
