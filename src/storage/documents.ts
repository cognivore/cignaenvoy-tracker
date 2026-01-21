/**
 * Medical Documents Storage
 *
 * Storage for medical documents with support for JSON files or SQLite backend.
 */

import type {
  MedicalDocument,
  CreateMedicalDocumentInput,
  DocumentClassification,
  PaymentOverride,
} from "../types/medical-document.js";
import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
  type StorageOperations,
} from "./base.js";
import { getStorageBackend } from "./repository.js";
import { hasPaymentSignal } from "../services/payment-signal.js";

// Lazy-load SQLite to avoid import errors when not using it
let sqliteModule: typeof import("./sqlite.js") | null = null;

async function getSqliteModule() {
  if (!sqliteModule) {
    sqliteModule = await import("./sqlite.js");
  }
  return sqliteModule;
}

/**
 * Get the appropriate storage backend.
 */
function getDocumentsStorage(): StorageOperations<MedicalDocument> {
  const backend = getStorageBackend();
  if (backend === "sqlite") {
    // Use SQLite repository (lazy-loaded synchronously for backwards compatibility)
    // Note: For full async support, callers should use the repository directly
    const sqlite = require("./sqlite.js") as typeof import("./sqlite.js");
    return sqlite.createSqliteRepository<MedicalDocument>("documents", [
      { column: "email_id", property: "emailId" },
      { column: "attachment_path", property: "attachmentPath" },
      { column: "calendar_event_id", property: "calendarEventId" },
      { column: "source_type", property: "sourceType" },
      { column: "account", property: "account" },
      { column: "date", property: "date" },
      { column: "classification", property: "classification" },
      { column: "archived_at", property: "archivedAt" },
      { column: "processed_at", property: "processedAt" },
    ]) as StorageOperations<MedicalDocument>;
  }
  return createStorage<MedicalDocument>(STORAGE_DIRS.documents, dateReviver);
}

/**
 * Storage operations for medical documents.
 */
export const documentsStorage = getDocumentsStorage();

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
 * Set or clear the payment override for a document.
 * Pass null to clear an existing override.
 */
export async function setPaymentOverride(
  id: string,
  override: Omit<PaymentOverride, "updatedAt"> | null
): Promise<MedicalDocument | null> {
  const existing = await documentsStorage.get(id);
  if (!existing) return null;

  // Clear override
  if (!override) {
    const { paymentOverride: _, ...rest } = existing;
    return documentsStorage.save(rest as MedicalDocument);
  }

  // Set override
  const updated: MedicalDocument = {
    ...existing,
    paymentOverride: { ...override, updatedAt: new Date() },
  };
  return documentsStorage.save(updated);
}

/**
 * Archive a document (manual or rule-based).
 */
export async function archiveDocument(
  id: string,
  input?: { reason?: string; ruleId?: string }
): Promise<MedicalDocument | null> {
  const existing = await documentsStorage.get(id);
  if (!existing) return null;

  const updated: MedicalDocument = {
    ...existing,
    archivedAt: new Date(),
    ...(input?.reason !== undefined && { archivedReason: input.reason }),
    ...(input?.ruleId !== undefined && { archivedByRuleId: input.ruleId }),
  };

  return documentsStorage.save(updated);
}

/**
 * Remove archive status from a document.
 */
export async function unarchiveDocument(
  id: string
): Promise<MedicalDocument | null> {
  const existing = await documentsStorage.get(id);
  if (!existing) return null;

  const { archivedAt: _, archivedByRuleId: __, archivedReason: ___, ...rest } =
    existing;
  return documentsStorage.save(rest as MedicalDocument);
}

/**
 * Find document by email ID.
 * Uses indexed lookup when SQLite backend is enabled.
 */
export async function findDocumentByEmailId(
  emailId: string
): Promise<MedicalDocument | null> {
  if (getStorageBackend() === "sqlite") {
    const sqlite = await getSqliteModule();
    return sqlite.findDocumentByEmailIdSqlite(emailId) as Promise<MedicalDocument | null>;
  }
  const docs = await documentsStorage.find((d) => d.emailId === emailId);
  return docs[0] ?? null;
}

/**
 * Find documents by attachment path.
 * Uses indexed lookup when SQLite backend is enabled.
 */
export async function findDocumentByAttachmentPath(
  attachmentPath: string
): Promise<MedicalDocument | null> {
  if (getStorageBackend() === "sqlite") {
    const sqlite = await getSqliteModule();
    return sqlite.findDocumentByAttachmentPathSqlite(attachmentPath) as Promise<MedicalDocument | null>;
  }
  const docs = await documentsStorage.find(
    (d) => d.attachmentPath === attachmentPath
  );
  return docs[0] ?? null;
}

/**
 * Find document by calendar event ID.
 * Uses indexed lookup when SQLite backend is enabled.
 */
export async function findDocumentByCalendarEventId(
  calendarEventId: string
): Promise<MedicalDocument | null> {
  if (getStorageBackend() === "sqlite") {
    const sqlite = await getSqliteModule();
    return sqlite.findDocumentByCalendarEventIdSqlite(calendarEventId) as Promise<MedicalDocument | null>;
  }
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
  const billLikeClasses = new Set(["medical_bill", "receipt"]);
  return documentsStorage.find(
    (d) =>
      !d.archivedAt &&
      billLikeClasses.has(d.classification) &&
      hasPaymentSignal(d)
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

    if (hasPaymentSignal(doc)) {
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
