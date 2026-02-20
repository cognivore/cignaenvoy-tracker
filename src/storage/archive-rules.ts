/**
 * Archive Rules Storage
 *
 * Backend-aware storage for auto-archive rules.
 * Uses SQLite when STORAGE_BACKEND=sqlite, otherwise JSON files.
 */

import type {
  ArchiveRule,
  CreateArchiveRuleInput,
  UpdateArchiveRuleInput,
} from "../types/archive-rule.js";
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

function getArchiveRulesStorage(): StorageOperations<ArchiveRule> {
  if (getStorageBackend() === "sqlite") {
    const sqlite = esmRequire("./sqlite.js") as typeof import("./sqlite.js");
    return sqlite.createSqliteRepository<ArchiveRule>("archive_rules", [
      { column: "name", property: "name" },
      { column: "enabled", property: "enabled" },
    ]) as StorageOperations<ArchiveRule>;
  }
  return createStorage<ArchiveRule>(STORAGE_DIRS.archiveRules, dateReviver);
}

/**
 * Storage operations for archive rules.
 */
export const archiveRulesStorage = getArchiveRulesStorage();

/**
 * Create a new archive rule.
 */
export async function createArchiveRule(
  input: CreateArchiveRuleInput
): Promise<ArchiveRule> {
  const now = new Date();
  const rule: ArchiveRule = {
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  return archiveRulesStorage.save(rule);
}

/**
 * Update an existing archive rule.
 */
export async function updateArchiveRule(
  id: string,
  updates: UpdateArchiveRuleInput
): Promise<ArchiveRule | null> {
  const existing = await archiveRulesStorage.get(id);
  if (!existing) return null;

  const updated: ArchiveRule = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };

  return archiveRulesStorage.save(updated);
}
