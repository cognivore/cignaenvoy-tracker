/**
 * Evidence types.
 * Documents and records proving that treatment occurred.
 */

/**
 * Types of evidence that can support a claim.
 * Source: Document upload page in claims flow lists common types.
 */
export type EvidenceType =
  | "Invoice"
  | "MedicalReport"
  | "Prescription"
  | "ProgressReport"
  | "CalendarEntry"
  | "Email"
  | "Other";

/** All available evidence types for iteration */
export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  "Invoice",
  "MedicalReport",
  "Prescription",
  "ProgressReport",
  "CalendarEntry",
  "Email",
  "Other",
] as const;

/**
 * Represents a piece of evidence supporting a treatment.
 * Evidence can come from various sources: physical documents, calendar entries, emails, etc.
 */
export interface Evidence {
  /** Internal UUID for local tracking */
  id: string;

  /** Reference to the treatment this evidence supports */
  treatmentId: string;

  /** Type of evidence */
  type: EvidenceType;

  /** Local file path if evidence is a stored file */
  filePath?: string;

  /** Original filename */
  fileName?: string;

  /** File size in bytes */
  fileSize?: number;

  /** MIME type of the file */
  mimeType?: string;

  /** Source URL if evidence is from external service (Google Calendar, email, etc.) */
  sourceUrl?: string;

  /** Date of the evidence (when it was created/issued) */
  date: Date;

  /** Human-readable description */
  description?: string;

  /** Raw content or extracted text (for searchability) */
  content?: string;

  /** Whether this evidence has been verified */
  verified: boolean;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Input type for creating new evidence (without auto-generated fields).
 */
export type CreateEvidenceInput = Omit<Evidence, "id" | "createdAt" | "updatedAt">;

/**
 * Input type for updating existing evidence.
 */
export type UpdateEvidenceInput = Partial<Omit<Evidence, "id" | "treatmentId" | "createdAt" | "updatedAt">>;
