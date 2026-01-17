/**
 * Illness Storage
 *
 * JSON file storage for illness/condition entities.
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
} from "./base.js";

/**
 * Storage operations for illnesses.
 */
export const illnessesStorage = createStorage<Illness>(
  STORAGE_DIRS.illnesses,
  dateReviver
);

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
