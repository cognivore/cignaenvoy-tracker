/**
 * Illness/condition tracking types.
 * Tracks patient conditions (acute/chronic) that generate claims.
 */

/** Type of illness based on duration and nature */
export type IllnessType = "acute" | "chronic";

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

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Input type for creating a new illness (without auto-generated fields).
 */
export type CreateIllnessInput = Omit<Illness, "id" | "createdAt" | "updatedAt">;

/**
 * Input type for updating an existing illness.
 */
export type UpdateIllnessInput = Partial<Omit<Illness, "id" | "patientId" | "createdAt" | "updatedAt">>;
