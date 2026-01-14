/**
 * Storage Base
 *
 * Core storage utilities - separated to avoid circular imports.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

/** Base data directory relative to project root */
const DATA_DIR = path.join(process.cwd(), "data");

/**
 * Storage directories.
 */
export const STORAGE_DIRS = {
  claims: path.join(DATA_DIR, "claims"),
  documents: path.join(DATA_DIR, "documents"),
  assignments: path.join(DATA_DIR, "assignments"),
} as const;

/**
 * Ensure all storage directories exist.
 */
export function ensureStorageDirs(): void {
  for (const dir of Object.values(STORAGE_DIRS)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generic storage operations for any entity type.
 */
export interface StorageOperations<T extends { id: string }> {
  /** Save an entity to storage */
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
}

/**
 * Create storage operations for a specific entity type and directory.
 */
export function createStorage<T extends { id: string }>(
  dir: string,
  reviver?: (key: string, value: unknown) => unknown
): StorageOperations<T> {
  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  const getFilePath = (id: string) => path.join(dir, `${id}.json`);

  return {
    async save(entity: T): Promise<T> {
      const filePath = getFilePath(entity.id);
      const json = JSON.stringify(entity, null, 2);
      await fs.promises.writeFile(filePath, json, "utf-8");
      return entity;
    },

    async get(id: string): Promise<T | null> {
      const filePath = getFilePath(id);
      try {
        const json = await fs.promises.readFile(filePath, "utf-8");
        return JSON.parse(json, reviver) as T;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw err;
      }
    },

    async getAll(): Promise<T[]> {
      try {
        const files = await fs.promises.readdir(dir);
        const entities: T[] = [];

        for (const file of files) {
          if (file.endsWith(".json")) {
            const filePath = path.join(dir, file);
            const json = await fs.promises.readFile(filePath, "utf-8");
            entities.push(JSON.parse(json, reviver) as T);
          }
        }

        return entities;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw err;
      }
    },

    async delete(id: string): Promise<boolean> {
      const filePath = getFilePath(id);
      try {
        await fs.promises.unlink(filePath);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return false;
        }
        throw err;
      }
    },

    async exists(id: string): Promise<boolean> {
      const filePath = getFilePath(id);
      try {
        await fs.promises.access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    async find(predicate: (entity: T) => boolean): Promise<T[]> {
      const all = await this.getAll();
      return all.filter(predicate);
    },
  };
}

/**
 * Generate a new UUID.
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * JSON reviver that converts ISO date strings back to Date objects.
 */
export function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === "string") {
    // ISO 8601 date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    if (dateRegex.test(value)) {
      return new Date(value);
    }
  }
  return value;
}
