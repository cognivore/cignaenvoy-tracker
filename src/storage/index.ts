/**
 * Storage Layer
 *
 * Storage for claims, documents, assignments, patients, and illnesses.
 * Supports both JSON file storage and SQLite for indexed lookups.
 *
 * Set STORAGE_BACKEND=sqlite to use SQLite (requires migration first).
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

// Re-export repository types
export {
  type Repository,
  type IndexedRepository,
  type StorageBackend,
  getStorageBackend,
} from "./repository.js";

// Re-export SQLite utilities (lazy-loaded when needed)
export {
  getDatabase,
  closeDatabase,
  createSqliteRepository,
  getStatsFast,
  type StatsResult,
} from "./sqlite.js";

// Re-export specific storage modules
export * from "./claims.js";
export * from "./documents.js";
export * from "./assignments.js";
export * from "./draft-claims.js";
export * from "./submitted-claims.js";
export * from "./patients.js";
export * from "./illnesses.js";
export * from "./archive-rules.js";
