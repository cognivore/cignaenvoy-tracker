/**
 * Patient identity management types.
 * Maps internal tracking to external Cigna identities.
 */

/** Patient relationship to the primary account holder */
export type PatientRelationship = "Employee" | "Member" | "Beneficiary";

/**
 * Represents a person covered under the Cigna Envoy policy.
 * Source: Account page in Cigna Envoy portal.
 */
export interface Patient {
  /** Internal UUID for local tracking */
  id: string;

  /** External Cigna Healthcare ID number (e.g., "88017286701") */
  cignaId: string;

  /** Full name as shown in Cigna system (e.g., "EMILS PETRACENOKS") */
  name: string;

  /** Relationship to account: Employee (primary), Member, or Beneficiary */
  relationship: PatientRelationship;

  /** Date of birth */
  dateOfBirth: Date;

  /** Country of citizenship (e.g., "LATVIA") */
  citizenship?: string;

  /** Work location country (e.g., "LATVIA") */
  workLocation?: string;

  /** Email address for contact */
  email?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Input type for creating a new patient (without auto-generated fields).
 */
export type CreatePatientInput = Omit<Patient, "id" | "createdAt" | "updatedAt">;

/**
 * Input type for updating an existing patient.
 */
export type UpdatePatientInput = Partial<Omit<Patient, "id" | "createdAt" | "updatedAt">>;
