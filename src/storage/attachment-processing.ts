/**
 * Attachment processing storage.
 *
 * Stores OCR attempt records for attachments to avoid reprocessing.
 * Uses indexed lookup when SQLite backend is enabled.
 */

import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
  type StorageOperations,
} from "./base.js";
import { getStorageBackend } from "./repository.js";
import type {
  AttachmentProcessingRecord,
  CreateAttachmentProcessingRecordInput,
  UpdateAttachmentProcessingRecordInput,
} from "../types/attachment-processing.js";

// Lazy-load SQLite
let sqliteModule: typeof import("./sqlite.js") | null = null;

async function getSqliteModule() {
  if (!sqliteModule) {
    sqliteModule = await import("./sqlite.js");
  }
  return sqliteModule;
}

function getAttachmentProcessingStorage(): StorageOperations<AttachmentProcessingRecord> {
  const backend = getStorageBackend();
  if (backend === "sqlite") {
    const sqlite = require("./sqlite.js") as typeof import("./sqlite.js");
    return sqlite.createSqliteRepository<AttachmentProcessingRecord>(
      "attachment_processing",
      [
        { column: "attachment_path", property: "attachmentPath" },
        { column: "email_id", property: "emailId" },
        { column: "account", property: "account" },
        { column: "status", property: "status" },
      ]
    ) as StorageOperations<AttachmentProcessingRecord>;
  }
  return createStorage<AttachmentProcessingRecord>(
    STORAGE_DIRS.attachmentProcessing,
    dateReviver
  );
}

const attachmentProcessingStorage = getAttachmentProcessingStorage();

/**
 * Find attachment processing record by path.
 * Uses indexed lookup when SQLite backend is enabled.
 */
export async function findAttachmentProcessingByPath(
  attachmentPath: string
): Promise<AttachmentProcessingRecord | null> {
  if (getStorageBackend() === "sqlite") {
    const sqlite = await getSqliteModule();
    return sqlite.findAttachmentProcessingByPathSqlite(attachmentPath) as Promise<AttachmentProcessingRecord | null>;
  }
  const matches = await attachmentProcessingStorage.find(
    (record) => record.attachmentPath === attachmentPath
  );
  return matches[0] ?? null;
}

export async function upsertAttachmentProcessingRecord(
  input: CreateAttachmentProcessingRecordInput
): Promise<AttachmentProcessingRecord> {
  const existing = await findAttachmentProcessingByPath(input.attachmentPath);
  if (existing) {
    const updated: AttachmentProcessingRecord = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };
    return attachmentProcessingStorage.save(updated);
  }

  const created: AttachmentProcessingRecord = {
    id: generateId(),
    ...input,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return attachmentProcessingStorage.save(created);
}

export async function updateAttachmentProcessingRecord(
  id: string,
  updates: UpdateAttachmentProcessingRecordInput
): Promise<AttachmentProcessingRecord | null> {
  const existing = await attachmentProcessingStorage.get(id);
  if (!existing) return null;

  const updated: AttachmentProcessingRecord = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };

  return attachmentProcessingStorage.save(updated);
}
