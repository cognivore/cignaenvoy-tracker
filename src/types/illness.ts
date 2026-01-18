/**
 * Illness/condition tracking types.
 * Tracks patient conditions (acute/chronic) that generate claims.
 */

/** Type of illness based on duration and nature */
export type IllnessType = "acute" | "chronic";

/** Role of a relevant account in relation to an illness */
export type AccountRole = "provider" | "pharmacy" | "lab" | "insurance" | "other";

/** All account roles for iteration */
export const ACCOUNT_ROLES: readonly AccountRole[] = [
  "provider",
  "pharmacy",
  "lab",
  "insurance",
  "other",
] as const;

/**
 * Represents an email address/account relevant to an illness.
 * These are extracted from evidence documents (emails, calendar events)
 * when a hydration candidate is confirmed.
 */
export interface RelevantAccount {
  /** Email address */
  email: string;

  /** Display name associated with the email */
  name?: string;

  /** Role of this account (provider, pharmacy, lab, etc.) */
  role?: AccountRole;

  /** When this account was added */
  addedAt: Date;

  /** ID of the source document this account was extracted from */
  sourceDocumentId?: string;
}

/**
 * Represents a medical condition that a patient has.
 * Illnesses cause claims when treated with facility visits or prescribed medication.
 * Source: Symptoms/Diagnosis search in claims flow.
 */
export interface Illness {
  /** Internal UUID for local tracking */
  id: string;

  /** Reference to the patient who has this illness */
  patientId: string;

  /** Human-readable name (e.g., "Anxiety") */
  name: string;

  /** ICD code or Cigna diagnosis description (e.g., "ANXIETY DISORDER, UNSPECIFIED") */
  icdCode?: string;

  /** Whether the condition is acute (temporary) or chronic (ongoing) */
  type: IllnessType;

  /** Date when the illness was first diagnosed or symptoms appeared */
  onsetDate?: Date;

  /** Date when the illness was resolved (for acute conditions) */
  resolvedDate?: Date;

  /** Additional notes about the condition */
  notes?: string;

  /**
   * Email addresses/accounts relevant to this illness.
   * Populated from evidence documents during hydration confirmation.
   */
  relevantAccounts: RelevantAccount[];

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Timestamp when illness was archived (if archived) */
  archivedAt?: Date;
}

/**
 * Input type for creating a new illness (without auto-generated fields).
 */
export type CreateIllnessInput = Omit<Illness, "id" | "relevantAccounts" | "createdAt" | "updatedAt" | "archivedAt">;

/**
 * Input type for updating an existing illness.
 */
export type UpdateIllnessInput = Partial<Omit<Illness, "id" | "patientId" | "createdAt" | "updatedAt">>;
