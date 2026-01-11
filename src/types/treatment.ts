/**
 * Treatment types.
 * Records instances when a patient treats an illness.
 */

/**
 * Treatment type categories as defined by Cigna Envoy outpatient claims.
 * These are multi-select checkboxes in the claim form.
 * Source: "Tell us more about the claim" step in new claim flow.
 */
export type TreatmentType =
  | "Chiropractic treatment"
  | "Consultation with medical practitioner and specialist"
  | "Maternity consultations or treatment"
  | "Osteopathy"
  | "Pathology tests and expenses"
  | "Physiotherapy"
  | "Prescribed medication"
  | "Psychiatric consultations or treatment"
  | "X-rays"
  | "Other";

/** All available treatment types for iteration */
export const TREATMENT_TYPES: readonly TreatmentType[] = [
  "Chiropractic treatment",
  "Consultation with medical practitioner and specialist",
  "Maternity consultations or treatment",
  "Osteopathy",
  "Pathology tests and expenses",
  "Physiotherapy",
  "Prescribed medication",
  "Psychiatric consultations or treatment",
  "X-rays",
  "Other",
] as const;

/** Facility type for the treatment */
export type FacilityType = "Outpatient" | "Inpatient";

/**
 * Represents a single instance of treatment for an illness.
 * A treatment may generate evidence documents and eventually become part of a claim.
 */
export interface Treatment {
  /** Internal UUID for local tracking */
  id: string;

  /** Reference to the patient who received treatment */
  patientId: string;

  /** Reference to the illness being treated */
  illnessId: string;

  /** Date of treatment (maps to "What was the earliest treatment date?") */
  treatmentDate: Date;

  /** Types of treatment received (can be multiple) */
  treatmentTypes: TreatmentType[];

  /** Country where care was received (e.g., "UNITED KINGDOM") */
  country: string;

  /** Whether treatment was outpatient or inpatient */
  facilityType: FacilityType;

  /** Cost of treatment in the specified currency */
  cost: number;

  /** Currency code (e.g., "EUROPEAN MONETARY UNION EURO") */
  currency: string;

  /** Whether this was a work-related accident or injury */
  isWorkRelated: boolean;

  /** Name of the healthcare provider/facility */
  providerName?: string;

  /** Address of the healthcare provider */
  providerAddress?: string;

  /** Additional notes about the treatment */
  notes?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Input type for creating a new treatment (without auto-generated fields).
 */
export type CreateTreatmentInput = Omit<Treatment, "id" | "createdAt" | "updatedAt">;

/**
 * Input type for updating an existing treatment.
 */
export type UpdateTreatmentInput = Partial<Omit<Treatment, "id" | "patientId" | "illnessId" | "createdAt" | "updatedAt">>;
