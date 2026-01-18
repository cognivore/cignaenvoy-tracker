/**
 * Storage Layer
 *
 * JSON file-based storage for claims, documents, assignments, patients, and illnesses.
 * Provides a simple, human-readable, git-friendly persistence layer.
 */

// Re-export base utilities
export {
  STORAGE_DIRS,
  ensureStorageDirs,
  createStorage,
  generateId,
  dateReviver,
  type StorageOperations,
} from "./base.js";

// Re-export specific storage modules
export * from "./claims.js";
export * from "./documents.js";
export * from "./assignments.js";
export * from "./draft-claims.js";
export * from "./patients.js";
export * from "./illnesses.js";
export * from "./archive-rules.js";
