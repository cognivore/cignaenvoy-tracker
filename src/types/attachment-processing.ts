/**
 * Attachment processing records.
 *
 * Tracks OCR attempts to avoid reprocessing unchanged attachments.
 */

export type AttachmentProcessingStatus = "non_medical" | "ocr_failed";

export interface AttachmentProcessingRecord {
  /** Internal UUID */
  id: string;

  /** File path for attachment */
  attachmentPath: string;

  /** Email metadata */
  emailId: string;
  account: string;
  filename: string;
  fileSize?: number;

  /** Processing status */
  status: AttachmentProcessingStatus;

  /** OCR attempt details */
  ocrCharCount?: number;
  lastError?: string;

  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

export type CreateAttachmentProcessingRecordInput = Omit<
  AttachmentProcessingRecord,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdateAttachmentProcessingRecordInput = Partial<
  Omit<AttachmentProcessingRecord, "id" | "attachmentPath" | "createdAt" | "updatedAt">
>;
