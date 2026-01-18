/**
 * Archive Rules Storage
 *
 * JSON file storage for auto-archive rules.
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
} from "./base.js";

/**
 * Storage operations for archive rules.
 */
export const archiveRulesStorage = createStorage<ArchiveRule>(
  STORAGE_DIRS.archiveRules,
  dateReviver
);

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
