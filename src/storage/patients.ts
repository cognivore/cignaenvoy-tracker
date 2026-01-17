/**
 * Patient Storage
 *
 * JSON file storage for patient entities.
 */

import type {
  Patient,
  CreatePatientInput,
  UpdatePatientInput,
} from "../types/patient.js";
import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
} from "./base.js";

/**
 * Storage operations for patients.
 */
export const patientsStorage = createStorage<Patient>(
  STORAGE_DIRS.patients,
  dateReviver
);

/**
 * Create a new patient record.
 */
export async function createPatient(
  input: CreatePatientInput
): Promise<Patient> {
  const now = new Date();
  const patient: Patient = {
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  return patientsStorage.save(patient);
}

/**
 * Update an existing patient.
 */
export async function updatePatient(
  id: string,
  updates: UpdatePatientInput
): Promise<Patient | null> {
  const existing = await patientsStorage.get(id);
  if (!existing) return null;

  const updated: Patient = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };
  return patientsStorage.save(updated);
}

/**
 * Find a patient by Cigna ID.
 */
export async function findPatientByCignaId(
  cignaId: string
): Promise<Patient | null> {
  const patients = await patientsStorage.find((p) => p.cignaId === cignaId);
  return patients[0] ?? null;
}

/**
 * Find patients by name (partial match).
 */
export async function findPatientsByName(name: string): Promise<Patient[]> {
  const normalizedName = name.toLowerCase();
  return patientsStorage.find((p) =>
    p.name.toLowerCase().includes(normalizedName)
  );
}

/**
 * Get patients by relationship type.
 */
export async function getPatientsByRelationship(
  relationship: Patient["relationship"]
): Promise<Patient[]> {
  return patientsStorage.find((p) => p.relationship === relationship);
}

/**
 * Get or create a patient by Cigna ID.
 * Useful for ensuring a patient record exists before creating illnesses.
 */
export async function getOrCreatePatient(
  input: CreatePatientInput
): Promise<Patient> {
  const existing = await findPatientByCignaId(input.cignaId);
  if (existing) return existing;
  return createPatient(input);
}
