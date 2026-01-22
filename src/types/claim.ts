/**
 * Claim types.
 * The actual claim submitted via Cigna Envoy portal.
 */

/**
 * Types of claims supported by Cigna Envoy.
 * Source: Claim type dropdown in new claim flow.
 */
export type ClaimType = "Medical" | "Vision" | "Dental";

/** All available claim types for iteration */
export const CLAIM_TYPES: readonly ClaimType[] = ["Medical", "Vision", "Dental"] as const;

/**
 * Status of a claim in the workflow.
 */
export type ClaimStatus =
  | "draft"      // Being prepared locally
  | "ready"      // Ready for submission
  | "submitted"  // Submitted to Cigna
  | "processing" // Being processed by Cigna
  | "approved"   // Claim approved
  | "rejected"   // Claim rejected
  | "paid";      // Payment received

/** All claim statuses for iteration */
export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "draft",
  "ready",
  "submitted",
  "processing",
  "approved",
  "rejected",
  "paid",
] as const;

/**
 * Symptom/diagnosis associated with a claim.
 * Up to 3 symptoms can be selected per claim.
 * Source: "What were the symptoms or diagnosis?" step in claims flow.
 */
export interface Symptom {
  /** Short name (e.g., "ANXIETY") */
  name: string;

  /** Full description/ICD code (e.g., "ANXIETY DISORDER, UNSPECIFIED") */
  description: string;
}

/**
 * Represents a claim to be submitted to Cigna Envoy.
 * A claim can combine multiple treatments and their evidence.
 */
export interface Claim {
  /** Internal UUID for local tracking */
  id: string;

  /** Reference to originating draft claim (if submitted from draft) */
  draftClaimId?: string;

  /** Reference to the patient this claim is for */
  patientId: string;

  /** Reference to illness this claim relates to */
  illnessId?: string;

  /** Supporting document IDs attached to this claim */
  documentIds?: string[];

  /** Proof-of-payment document IDs attached to this claim */
  proofDocumentIds?: string[];

  /** References to treatments included in this claim */
  treatmentIds: string[];

  /** Type of claim (Medical, Vision, or Dental) */
  claimType: ClaimType;

  /** Current status in the workflow */
  status: ClaimStatus;

  /** External Cigna claim ID after submission */
  cignaClaimId?: string;

  /** Submission number assigned by Cigna */
  submissionNumber?: string;

  /** URL to the submission confirmation */
  submissionUrl?: string;

  /** URL to the claim details page */
  claimUrl?: string;

  /** Symptoms/diagnoses (up to 3) */
  symptoms: Symptom[];

  /** Total amount claimed */
  totalAmount: number;

  /** Currency of the claim */
  currency: string;

  /** Country where care was received */
  country: string;

  /** Date claim was submitted to Cigna */
  submittedAt?: Date;

  /** Date claim was processed/decided */
  processedAt?: Date;

  /** Amount approved (may differ from total) */
  approvedAmount?: number;

  /** Rejection reason if applicable */
  rejectionReason?: string;

  /** Additional notes */
  notes?: string;

  /** Submission log entries */
  submissionLog?: string[];

  /** Submission errors */
  submissionErrors?: string[];

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Timestamp when claim was archived (if archived) */
  archivedAt?: Date;
}

/**
 * Allowed MIME types for claim documents.
 * Source: Document upload page restrictions.
 */
export type AllowedMimeType =
  | "image/bmp"
  | "application/pdf"
  | "image/png"
  | "image/jpg"
  | "image/jpeg"
  | "image/gif";

/** File extensions allowed for upload */
export const ALLOWED_FILE_EXTENSIONS = [".bmp", ".pdf", ".png", ".jpg", ".jpeg", ".gif"] as const;

/** Maximum file size per document (6 MB) */
export const MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024;

/** Maximum total attachments size per claim (30 MB) */
export const MAX_TOTAL_ATTACHMENTS_BYTES = 30 * 1024 * 1024;

/**
 * Document attached to a claim for submission.
 * Source: "Please upload all documents" step in claims flow.
 */
export interface ClaimDocument {
  /** Internal UUID for local tracking */
  id: string;

  /** Reference to the claim this document belongs to */
  claimId: string;

  /** Reference to the evidence this document was created from (if applicable) */
  evidenceId?: string;

  /** Filename for display and upload */
  fileName: string;

  /** File size in bytes (max 6 MB per file) */
  fileSize: number;

  /** MIME type of the file */
  mimeType: AllowedMimeType;

  /** Local file path */
  filePath: string;

  /** Order in which document should be submitted */
  order: number;

  /** Timestamp when document was added to claim */
  uploadedAt: Date;
}

/**
 * Input type for creating a new claim (without auto-generated fields).
 */
export type CreateClaimInput = Omit<Claim, "id" | "status" | "cignaClaimId" | "submittedAt" | "processedAt" | "approvedAmount" | "rejectionReason" | "createdAt" | "updatedAt">;

/**
 * Input type for updating an existing claim.
 */
export type UpdateClaimInput = Partial<Omit<Claim, "id" | "patientId" | "createdAt" | "updatedAt">>;

/**
 * Input type for creating a claim document.
 */
export type CreateClaimDocumentInput = Omit<ClaimDocument, "id" | "uploadedAt">;
