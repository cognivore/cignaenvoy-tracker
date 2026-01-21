/**
 * Repository interface for storage backends.
 *
 * Provides a common interface that can be implemented by JSON file storage
 * or SQLite for indexed lookups.
 */

/**
 * Generic repository operations.
 */
export interface Repository<T extends { id: string }> {
  /** Save (insert or update) an entity */
  save(entity: T): Promise<T>;

  /** Get an entity by ID */
  get(id: string): Promise<T | null>;

  /** Get all entities */
  getAll(): Promise<T[]>;

  /** Delete an entity by ID */
  delete(id: string): Promise<boolean>;

  /** Check if an entity exists */
  exists(id: string): Promise<boolean>;

  /** Find entities matching a predicate */
  find(predicate: (entity: T) => boolean): Promise<T[]>;

  /** Count all entities */
  count(): Promise<number>;
}

/**
 * Extended repository with indexed lookups.
 */
export interface IndexedRepository<T extends { id: string }> extends Repository<T> {
  /** Find one entity by a unique indexed field */
  findByIndex<K extends keyof T>(field: K, value: T[K]): Promise<T | null>;

  /** Find all entities matching an indexed field */
  findAllByIndex<K extends keyof T>(field: K, value: T[K]): Promise<T[]>;

  /** Count entities matching an indexed field */
  countByIndex<K extends keyof T>(field: K, value: T[K]): Promise<number>;
}

/**
 * Storage backend type.
 */
export type StorageBackend = "json" | "sqlite";

/**
 * Get the current storage backend from environment.
 */
export function getStorageBackend(): StorageBackend {
  const backend = process.env.STORAGE_BACKEND?.toLowerCase();
  if (backend === "sqlite") return "sqlite";
  return "json";
}
