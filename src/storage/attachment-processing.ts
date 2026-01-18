/**
 * Attachment processing storage.
 *
 * Stores OCR attempt records for attachments to avoid reprocessing.
 */

import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
} from "./base.js";
import type {
  AttachmentProcessingRecord,
  CreateAttachmentProcessingRecordInput,
  UpdateAttachmentProcessingRecordInput,
} from "../types/attachment-processing.js";

const attachmentProcessingStorage = createStorage<AttachmentProcessingRecord>(
  STORAGE_DIRS.attachmentProcessing,
  dateReviver
);

export async function findAttachmentProcessingByPath(
  attachmentPath: string
): Promise<AttachmentProcessingRecord | null> {
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
