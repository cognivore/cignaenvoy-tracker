/**
 * Illness Storage
 *
 * Backend-aware storage for illness/condition entities.
 * Uses SQLite when STORAGE_BACKEND=sqlite, otherwise JSON files.
 */

import type {
  Illness,
  CreateIllnessInput,
  UpdateIllnessInput,
  RelevantAccount,
} from "../types/illness.js";
import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
  type StorageOperations,
} from "./base.js";
import { getStorageBackend } from "./repository.js";
import { createRequire } from "node:module";

const esmRequire = createRequire(import.meta.url);

function getIllnessesStorage(): StorageOperations<Illness> {
  if (getStorageBackend() === "sqlite") {
    const sqlite = esmRequire("./sqlite.js") as typeof import("./sqlite.js");
    return sqlite.createSqliteRepository<Illness>("illnesses", [
      { column: "patient_id", property: "patientId" },
      { column: "name", property: "name" },
    ]) as StorageOperations<Illness>;
  }
  return createStorage<Illness>(STORAGE_DIRS.illnesses, dateReviver);
}

/**
 * Storage operations for illnesses.
 */
export const illnessesStorage = getIllnessesStorage();

/**
 * Create a new illness record.
 */
export async function createIllness(
  input: CreateIllnessInput
): Promise<Illness> {
  const now = new Date();
  const illness: Illness = {
    ...input,
    id: generateId(),
    relevantAccounts: [],
    createdAt: now,
    updatedAt: now,
  };
  return illnessesStorage.save(illness);
}

/**
 * Update an existing illness.
 */
export async function updateIllness(
  id: string,
  updates: UpdateIllnessInput
): Promise<Illness | null> {
  const existing = await illnessesStorage.get(id);
  if (!existing) return null;

  const updated: Illness = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };
  return illnessesStorage.save(updated);
}

/**
 * Get all illnesses for a patient.
 */
export async function getIllnessesForPatient(
  patientId: string
): Promise<Illness[]> {
  return illnessesStorage.find((i) => i.patientId === patientId);
}

/**
 * Get active illnesses for a patient (not resolved).
 */
export async function getActiveIllnesses(patientId: string): Promise<Illness[]> {
  return illnessesStorage.find(
    (i) => i.patientId === patientId && !i.resolvedDate
  );
}

/**
 * Get chronic illnesses for a patient.
 */
export async function getChronicIllnesses(patientId: string): Promise<Illness[]> {
  return illnessesStorage.find(
    (i) => i.patientId === patientId && i.type === "chronic"
  );
}

/**
 * Find illnesses by name (partial match).
 */
export async function findIllnessesByName(name: string): Promise<Illness[]> {
  const normalizedName = name.toLowerCase();
  return illnessesStorage.find((i) =>
    i.name.toLowerCase().includes(normalizedName)
  );
}

/**
 * Find illnesses by ICD code.
 */
export async function findIllnessesByIcdCode(
  icdCode: string
): Promise<Illness[]> {
  const normalizedCode = icdCode.toLowerCase();
  return illnessesStorage.find(
    (i) => i.icdCode?.toLowerCase().includes(normalizedCode) ?? false
  );
}

/**
 * Add relevant accounts to an illness.
 * Deduplicates by email address.
 */
export async function addRelevantAccounts(
  illnessId: string,
  accounts: RelevantAccount[]
): Promise<Illness | null> {
  const illness = await illnessesStorage.get(illnessId);
  if (!illness) return null;

  // Deduplicate by email
  const existingEmails = new Set(
    illness.relevantAccounts.map((a) => a.email.toLowerCase())
  );

  const newAccounts = accounts.filter(
    (a) => !existingEmails.has(a.email.toLowerCase())
  );

  if (newAccounts.length === 0) {
    return illness; // No new accounts to add
  }

  const updated: Illness = {
    ...illness,
    relevantAccounts: [...illness.relevantAccounts, ...newAccounts],
    updatedAt: new Date(),
  };

  return illnessesStorage.save(updated);
}

/**
 * Get illnesses that have a specific email in relevant accounts.
 */
export async function getIllnessesByRelevantEmail(
  email: string
): Promise<Illness[]> {
  const normalizedEmail = email.toLowerCase();
  return illnessesStorage.find((i) =>
    i.relevantAccounts.some((a) => a.email.toLowerCase() === normalizedEmail)
  );
}

/**
 * Resolve an illness (mark as no longer active).
 */
export async function resolveIllness(
  id: string,
  resolvedDate: Date = new Date()
): Promise<Illness | null> {
  return updateIllness(id, { resolvedDate });
}

/**
 * Archive an illness.
 */
export async function archiveIllness(id: string): Promise<Illness | null> {
  return updateIllness(id, { archivedAt: new Date() });
}

/**
 * Unarchive an illness.
 */
export async function unarchiveIllness(id: string): Promise<Illness | null> {
  const existing = await illnessesStorage.get(id);
  if (!existing) return null;

  const { archivedAt: _, ...rest } = existing;
  const updated: Illness = { ...rest, updatedAt: new Date() };
  return illnessesStorage.save(updated);
}

/**
 * Get all archived illnesses.
 */
export async function getArchivedIllnesses(): Promise<Illness[]> {
  return illnessesStorage.find((i) => !!i.archivedAt);
}

/**
 * Get all non-archived illnesses.
 */
export async function getActiveIllnessesAll(): Promise<Illness[]> {
  return illnessesStorage.find((i) => !i.archivedAt);
}
