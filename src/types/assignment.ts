/**
 * Document-to-claim assignment types.
 * Links medical documents to scraped claims.
 */

/**
 * Status of a document-claim assignment.
 */
export type AssignmentStatus = "candidate" | "confirmed" | "rejected";

/** All assignment statuses */
export const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  "candidate",
  "confirmed",
  "rejected",
] as const;

/**
 * Reason why a document was matched to a claim.
 */
export type MatchReasonType =
  | "exact_amount"
  | "approximate_amount"
  | "date_proximity"
  | "provider_match"
  | "manual";

/** All match reason types */
export const MATCH_REASON_TYPES: readonly MatchReasonType[] = [
  "exact_amount",
  "approximate_amount",
  "date_proximity",
  "provider_match",
  "manual",
] as const;

/**
 * Document-to-claim assignment.
 * Represents a link (confirmed or candidate) between a medical document
 * and a scraped claim.
 */
export interface DocumentClaimAssignment {
  /** Internal UUID for local tracking */
  id: string;

  /** Reference to the medical document */
  documentId: string;

  /** Reference to the scraped claim */
  claimId: string;

  /**
   * Reference to the illness this evidence supports.
   * Required when confirming an assignment.
   */
  illnessId?: string;

  /** Match confidence score (0-100) */
  matchScore: number;

  /** Primary reason for the match */
  matchReasonType: MatchReasonType;

  /** Human-readable explanation of the match */
  matchReason: string;

  /** Current status of this assignment */
  status: AssignmentStatus;

  /** Details about the amount match if applicable */
  amountMatchDetails?: {
    documentAmount: number;
    documentCurrency: string;
    claimAmount: number;
    claimCurrency: string;
    difference: number;
    differencePercent: number;
  };

  /** Details about the date match if applicable */
  dateMatchDetails?: {
    documentDate: Date;
    claimDate: Date;
    daysDifference: number;
  };

  /** Timestamp when assignment was created */
  createdAt: Date;

  /** Timestamp when status was last updated */
  updatedAt: Date;

  /** Timestamp when confirmed (if status is confirmed) */
  confirmedAt?: Date;

  /** User who confirmed (for audit trail) */
  confirmedBy?: string;

  /** Notes added during review */
  reviewNotes?: string;
}

/**
 * Input for creating a new assignment.
 */
export type CreateAssignmentInput = Omit<
  DocumentClaimAssignment,
  "id" | "status" | "createdAt" | "updatedAt" | "confirmedAt" | "confirmedBy" | "reviewNotes"
>;

/**
 * Input for updating an assignment (during review).
 */
export type UpdateAssignmentInput = Pick<
  DocumentClaimAssignment,
  "status" | "reviewNotes"
>;

/**
 * Thresholds for match scoring.
 */
export const MATCH_THRESHOLDS = {
  /** Amount difference percentage for exact match */
  EXACT_AMOUNT_TOLERANCE: 0.01, // 1%

  /** Amount difference percentage for approximate match */
  APPROXIMATE_AMOUNT_TOLERANCE: 0.10, // 10%

  /** Days proximity for date match bonus */
  DATE_PROXIMITY_DAYS: 30,

  /** Days beyond which date mismatch penalty applies */
  DATE_MISMATCH_PENALTY_THRESHOLD: 60,

  /** Days beyond which no match is possible (hard cutoff) */
  MAX_DATE_MISMATCH_DAYS: 90,

  /** Points deducted for date mismatch beyond threshold */
  DATE_MISMATCH_PENALTY: 40,

  /** Minimum score to be considered a candidate */
  MINIMUM_CANDIDATE_SCORE: 50,

  /** Score for exact amount match */
  EXACT_AMOUNT_SCORE: 80,

  /** Score for approximate amount match */
  APPROXIMATE_AMOUNT_SCORE: 60,

  /** Bonus score for date proximity */
  DATE_PROXIMITY_BONUS: 15,

  /** Bonus score for provider name match */
  PROVIDER_MATCH_BONUS: 10,
} as const;
