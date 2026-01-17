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
  | "appointment"
  | "unknown";

/** All document classifications */
export const DOCUMENT_CLASSIFICATIONS: readonly DocumentClassification[] = [
  "medical_bill",
  "correspondence",
  "receipt",
  "prescription",
  "lab_result",
  "insurance_statement",
  "appointment",
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
 * Manual payment override set by user when OCR detection is incorrect.
 */
export interface PaymentOverride {
  /** The corrected amount */
  amount: number;

  /** Currency code (e.g., "EUR", "GBP", "USD") */
  currency: string;

  /** Optional note explaining why the override was made */
  note?: string;

  /** Timestamp when override was set */
  updatedAt: Date;
}

/**
 * Calendar attendee information.
 */
export interface CalendarAttendee {
  /** Email address of the attendee */
  email: string;

  /** Display name of the attendee */
  name?: string;

  /** Response status (accepted, declined, tentative, needsAction) */
  response?: string;

  /** Whether this attendee is the organizer */
  organizer?: boolean;
}

/**
 * Calendar organizer information.
 */
export interface CalendarOrganizer {
  /** Email address of the organizer */
  email?: string;

  /** Display name of the organizer */
  displayName?: string;
}

/**
 * Medical document from email/attachment/calendar.
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

  // === Calendar-specific fields ===

  /** Calendar event ID if from calendar */
  calendarEventId?: string;

  /** Calendar ID the event belongs to */
  calendarId?: string;

  /** Calendar event summary/title */
  calendarSummary?: string;

  /** Calendar event description */
  calendarDescription?: string;

  /** Calendar event location */
  calendarLocation?: string;

  /** Calendar event start time */
  calendarStart?: Date;

  /** Calendar event end time */
  calendarEnd?: Date;

  /** Whether this is an all-day event */
  calendarAllDay?: boolean;

  /** Attendees from calendar event */
  calendarAttendees?: CalendarAttendee[];

  /** Organizer from calendar event */
  calendarOrganizer?: CalendarOrganizer;

  /** Video conference URL if present */
  calendarConferenceUrl?: string;

  // === Override fields ===

  /** Manual payment override set by user when OCR detection is incorrect */
  paymentOverride?: PaymentOverride;

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
