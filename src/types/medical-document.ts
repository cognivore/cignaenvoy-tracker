/**
 * Medical document types.
 * Documents extracted from email/attachment dumps via OCR.
 */

/**
 * Source type indicating where the document came from.
 */
export type DocumentSourceType = "email" | "attachment" | "calendar";

/** All document source types */
export const DOCUMENT_SOURCE_TYPES: readonly DocumentSourceType[] = [
  "email",
  "attachment",
  "calendar",
] as const;

/**
 * Classification of medical document based on content analysis.
 */
export type DocumentClassification =
  | "medical_bill"
  | "correspondence"
  | "receipt"
  | "prescription"
  | "lab_result"
  | "insurance_statement"
  | "unknown";

/** All document classifications */
export const DOCUMENT_CLASSIFICATIONS: readonly DocumentClassification[] = [
  "medical_bill",
  "correspondence",
  "receipt",
  "prescription",
  "lab_result",
  "insurance_statement",
  "unknown",
] as const;

/**
 * Amount detected in OCR'd document text.
 */
export interface DetectedAmount {
  /** The numeric value */
  value: number;

  /** Currency code (e.g., "EUR", "GBP", "USD") */
  currency: string;

  /** Raw text that was parsed (e.g., "EUR 80.00") */
  rawText: string;

  /** Context around the amount (surrounding text) */
  context?: string;

  /** Confidence score 0-100 */
  confidence: number;
}

/**
 * Medical document from email/attachment dumps.
 * Represents any document that appears to be medical-related.
 */
export interface MedicalDocument {
  /** Internal UUID for local tracking */
  id: string;

  /** Where the document came from */
  sourceType: DocumentSourceType;

  /** Email ID if from email/attachment (links to ~/.qwen/data/) */
  emailId?: string;

  /** Account name in qwen data (e.g., "ep", "jm") */
  account?: string;

  /** Path to attachment file if applicable */
  attachmentPath?: string;

  /** Original filename */
  filename?: string;

  /** MIME type of the source file */
  mimeType?: string;

  /** File size in bytes */
  fileSize?: number;

  /** Extracted text from OCR */
  ocrText?: string;

  /** Character count of OCR text */
  ocrCharCount?: number;

  /** Amounts detected in the document */
  detectedAmounts: DetectedAmount[];

  /** Classification based on content */
  classification: DocumentClassification;

  /** Email from address if from email */
  fromAddress?: string;

  /** Email to address if from email */
  toAddress?: string;

  /** Email subject if from email */
  subject?: string;

  /** Email body snippet */
  bodySnippet?: string;

  /** Date of the source email/document */
  date?: Date;

  /** Keywords found that suggest medical content */
  medicalKeywords: string[];

  /** Timestamp when this document was processed */
  processedAt: Date;
}

/**
 * Input for creating a medical document record.
 */
export type CreateMedicalDocumentInput = Omit<MedicalDocument, "id" | "processedAt">;

/**
 * Keywords used to identify medical content.
 */
export const MEDICAL_KEYWORDS: readonly string[] = [
  // Healthcare providers
  "doctor",
  "hospital",
  "clinic",
  "medical",
  "healthcare",
  "physician",
  "therapist",
  "psychologist",
  "psychiatrist",
  "dentist",
  "optometrist",
  // Treatments
  "treatment",
  "consultation",
  "appointment",
  "prescription",
  "medication",
  "therapy",
  "surgery",
  "diagnosis",
  // Insurance
  "insurance",
  "claim",
  "cigna",
  "reimbursement",
  "coverage",
  "copay",
  "deductible",
  // Documents
  "invoice",
  "bill",
  "receipt",
  "statement",
  "lab result",
  "test result",
] as const;
