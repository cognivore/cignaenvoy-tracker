import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const originalCwd = process.cwd();

async function loadModules() {
  const documents = await import("../../../src/storage/documents.js");
  const archiveRulesStorage = await import("../../../src/storage/archive-rules.js");
  const archiveRules = await import("../../../src/services/archive-rules.js");
  return { documents, archiveRulesStorage, archiveRules };
}

describe("Archive rules", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-rules-"));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("matches rule conditions case-insensitively", async () => {
    const { archiveRules } = await loadModules();

    const rule = {
      id: "rule-1",
      name: "Hetzner",
      enabled: true,
      fromContains: "hetzner.com",
      subjectContains: "invoice",
      attachmentNameContains: "pdf",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(
      archiveRules.matchesArchiveRule(rule, {
        fromAddress: "billing@Hetzner.com",
        subject: "Invoice May 2026",
        attachmentName: "Invoice.PDF",
      })
    ).toBe(true);

    expect(
      archiveRules.matchesArchiveRule(rule, {
        fromAddress: "billing@Hetzner.com",
        subject: "Account update",
        attachmentName: "Invoice.PDF",
      })
    ).toBe(false);
  });

  it("archives documents that match the rule", async () => {
    const { documents, archiveRulesStorage, archiveRules } = await loadModules();

    const rule = await archiveRulesStorage.createArchiveRule({
      name: "Archive Hetzner",
      enabled: true,
      fromContains: "hetzner.com",
    });

    const matching = await documents.createMedicalDocument({
      sourceType: "email",
      fromAddress: "billing@hetzner.com",
      subject: "Invoice 2026-01",
      detectedAmounts: [],
      classification: "unknown",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    const nonMatching = await documents.createMedicalDocument({
      sourceType: "email",
      fromAddress: "doctor@example.com",
      subject: "Receipt",
      detectedAmounts: [],
      classification: "receipt",
      medicalKeywords: [],
      date: new Date("2026-01-11"),
    });

    const updated = await archiveRules.applyArchiveRuleToExistingDocuments(rule);

    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe(matching.id);
    expect(updated[0]?.archivedByRuleId).toBe(rule.id);

    const storedMatching = await documents.documentsStorage.get(matching.id);
    const storedNonMatching = await documents.documentsStorage.get(nonMatching.id);

    expect(storedMatching?.archivedAt).toBeInstanceOf(Date);
    expect(storedMatching?.archivedByRuleId).toBe(rule.id);
    expect(storedNonMatching?.archivedAt).toBeUndefined();
  });
});
