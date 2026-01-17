/**
 * Medical Documents Storage
 *
 * JSON file storage for medical documents from email/attachment dumps.
 */

import type {
  MedicalDocument,
  CreateMedicalDocumentInput,
  DocumentClassification,
} from "../types/medical-document.js";
import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
} from "./base.js";

/**
 * Storage operations for medical documents.
 */
export const documentsStorage = createStorage<MedicalDocument>(
  STORAGE_DIRS.documents,
  dateReviver
);

/**
 * Create a new medical document record.
 */
export async function createMedicalDocument(
  input: CreateMedicalDocumentInput
): Promise<MedicalDocument> {
  const document: MedicalDocument = {
    ...input,
    id: generateId(),
    processedAt: new Date(),
  };
  return documentsStorage.save(document);
}

/**
 * Update an existing medical document.
 */
export async function updateMedicalDocument(
  id: string,
  updates: Partial<Omit<MedicalDocument, "id">>
): Promise<MedicalDocument | null> {
  const existing = await documentsStorage.get(id);
  if (!existing) return null;

  const updated: MedicalDocument = {
    ...existing,
    ...updates,
  };
  return documentsStorage.save(updated);
}

/**
 * Find document by email ID.
 */
export async function findDocumentByEmailId(
  emailId: string
): Promise<MedicalDocument | null> {
  const docs = await documentsStorage.find((d) => d.emailId === emailId);
  return docs[0] ?? null;
}

/**
 * Find documents by attachment path.
 */
export async function findDocumentByAttachmentPath(
  attachmentPath: string
): Promise<MedicalDocument | null> {
  const docs = await documentsStorage.find(
    (d) => d.attachmentPath === attachmentPath
  );
  return docs[0] ?? null;
}

/**
 * Find document by calendar event ID.
 */
export async function findDocumentByCalendarEventId(
  calendarEventId: string
): Promise<MedicalDocument | null> {
  const docs = await documentsStorage.find(
    (d) => d.calendarEventId === calendarEventId
  );
  return docs[0] ?? null;
}

/**
 * Get documents by classification.
 */
export async function getDocumentsByClassification(
  classification: DocumentClassification
): Promise<MedicalDocument[]> {
  return documentsStorage.find((d) => d.classification === classification);
}

/**
 * Get unassigned documents (documents without any confirmed assignment).
 * This requires checking the assignments storage.
 */
export async function getUnassignedDocuments(): Promise<MedicalDocument[]> {
  // For now, return all documents - the frontend will filter by assignment status
  return documentsStorage.getAll();
}

/**
 * Get documents with detected amounts in a range.
 */
export async function getDocumentsByAmountRange(
  minAmount: number,
  maxAmount: number,
  currency?: string
): Promise<MedicalDocument[]> {
  return documentsStorage.find((d) =>
    d.detectedAmounts.some((amount) => {
      const inRange = amount.value >= minAmount && amount.value <= maxAmount;
      const currencyMatch = !currency || amount.currency === currency;
      return inRange && currencyMatch;
    })
  );
}

/**
 * Get documents by account.
 */
export async function getDocumentsByAccount(
  account: string
): Promise<MedicalDocument[]> {
  return documentsStorage.find((d) => d.account === account);
}

/**
 * Get documents within a date range.
 */
export async function getDocumentsByDateRange(
  startDate: Date,
  endDate: Date
): Promise<MedicalDocument[]> {
  return documentsStorage.find((d) => {
    if (!d.date) return false;
    const docDate = new Date(d.date);
    return docDate >= startDate && docDate <= endDate;
  });
}

/**
 * Search documents by text content.
 */
export async function searchDocuments(
  searchText: string
): Promise<MedicalDocument[]> {
  const normalizedSearch = searchText.toLowerCase();
  return documentsStorage.find((d) => {
    const searchableText = [
      d.ocrText,
      d.subject,
      d.bodySnippet,
      d.filename,
      d.fromAddress,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedSearch);
  });
}

/**
 * Get documents that look like medical bills (for matching).
 */
export async function getMedicalBills(): Promise<MedicalDocument[]> {
  return documentsStorage.find(
    (d) =>
      d.classification === "medical_bill" && d.detectedAmounts.length > 0
  );
}

/**
 * Get document statistics.
 */
export async function getDocumentStats(): Promise<{
  total: number;
  byClassification: Record<string, number>;
  byAccount: Record<string, number>;
  withAmounts: number;
}> {
  const docs = await documentsStorage.getAll();

  const byClassification: Record<string, number> = {};
  const byAccount: Record<string, number> = {};
  let withAmounts = 0;

  for (const doc of docs) {
    byClassification[doc.classification] =
      (byClassification[doc.classification] ?? 0) + 1;

    if (doc.account) {
      byAccount[doc.account] = (byAccount[doc.account] ?? 0) + 1;
    }

    if (doc.detectedAmounts.length > 0) {
      withAmounts++;
    }
  }

  return {
    total: docs.length,
    byClassification,
    byAccount,
    withAmounts,
  };
}
