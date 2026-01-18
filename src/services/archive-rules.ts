/**
 * Archive rule helpers.
 *
 * Match email/attachment metadata against archive rules and apply them.
 */

import type { ArchiveRule } from "../types/archive-rule.js";
import type { MedicalDocument } from "../types/medical-document.js";
import { archiveRulesStorage } from "../storage/archive-rules.js";
import { documentsStorage, updateMedicalDocument } from "../storage/documents.js";

export interface ArchiveRuleMatchInput {
  fromAddress?: string;
  subject?: string;
  attachmentName?: string;
}

function normalize(value?: string): string {
  return (value ?? "").toLowerCase().trim();
}

function hasCriteria(rule: ArchiveRule): boolean {
  return (
    !!rule.fromContains ||
    !!rule.subjectContains ||
    !!rule.attachmentNameContains
  );
}

export function matchesArchiveRule(
  rule: ArchiveRule,
  input: ArchiveRuleMatchInput
): boolean {
  if (!rule.enabled || !hasCriteria(rule)) return false;

  const from = normalize(input.fromAddress);
  const subject = normalize(input.subject);
  const attachment = normalize(input.attachmentName);

  if (rule.fromContains && !from.includes(normalize(rule.fromContains))) {
    return false;
  }
  if (
    rule.subjectContains &&
    !subject.includes(normalize(rule.subjectContains))
  ) {
    return false;
  }
  if (
    rule.attachmentNameContains &&
    !attachment.includes(normalize(rule.attachmentNameContains))
  ) {
    return false;
  }

  return true;
}

export function buildArchiveReason(rule: ArchiveRule): string {
  return `Rule: ${rule.name}`;
}

export function applyArchiveRuleToDocument(
  document: MedicalDocument,
  rule: ArchiveRule,
  now: Date = new Date()
): MedicalDocument {
  if (document.archivedAt && document.archivedByRuleId === rule.id) {
    return document;
  }

  return {
    ...document,
    archivedAt: now,
    archivedByRuleId: rule.id,
    archivedReason: buildArchiveReason(rule),
  };
}

export async function findMatchingArchiveRule(
  input: ArchiveRuleMatchInput
): Promise<ArchiveRule | null> {
  const rules = await archiveRulesStorage.getAll();
  const sorted = [...rules].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  for (const rule of sorted) {
    if (matchesArchiveRule(rule, input)) {
      return rule;
    }
  }

  return null;
}

export async function applyArchiveRuleToExistingDocuments(
  rule: ArchiveRule
): Promise<MedicalDocument[]> {
  const docs = await documentsStorage.getAll();
  const updatedDocs: MedicalDocument[] = [];

  for (const doc of docs) {
    if (doc.archivedAt) continue;
    const matches = matchesArchiveRule(rule, {
      fromAddress: doc.fromAddress,
      subject: doc.subject,
      attachmentName: doc.filename,
    });
    if (!matches) continue;
    const archived = applyArchiveRuleToDocument(doc, rule);
    const saved = await updateMedicalDocument(doc.id, {
      archivedAt: archived.archivedAt,
      archivedByRuleId: archived.archivedByRuleId,
      archivedReason: archived.archivedReason,
    });
    if (saved) {
      updatedDocs.push(saved);
    }
  }

  return updatedDocs;
}
