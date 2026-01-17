import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const originalCwd = process.cwd();

async function loadModules() {
  const documents = await import("../../../src/storage/documents.js");
  const assignments = await import("../../../src/storage/assignments.js");
  const drafts = await import("../../../src/storage/draft-claims.js");
  const generator = await import("../../../src/services/draft-claim-generator.js");
  return { documents, assignments, drafts, generator };
}

function createAmount(value: number) {
  return {
    value,
    currency: "EUR",
    rawText: `EUR ${value}`,
    confidence: 90,
  };
}

describe("Draft claim generator", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-claims-"));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates draft claims for unattached attachments with amounts", async () => {
    const { documents, generator } = await loadModules();

    const doc = await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [createAmount(120)],
      classification: "medical_bill",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    const created = await generator.generateDraftClaims("forever", new Date("2026-01-16"));

    expect(created).toHaveLength(1);
    expect(created[0]?.primaryDocumentId).toBe(doc.id);
  });

  it("skips documents already linked to claims or draft claims", async () => {
    const { documents, assignments, drafts, generator } = await loadModules();

    const assignedDoc = await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [createAmount(50)],
      classification: "receipt",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    await assignments.createAssignment({
      documentId: assignedDoc.id,
      claimId: "claim-1",
      matchScore: 80,
      matchReasonType: "exact_amount",
      matchReason: "Exact amount match",
    });

    const draftedDoc = await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [createAmount(75)],
      classification: "medical_bill",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    await drafts.createDraftClaim({
      status: "pending",
      primaryDocumentId: draftedDoc.id,
      documentIds: [draftedDoc.id],
      payment: {
        amount: 75,
        currency: "EUR",
        rawText: "EUR 75",
        confidence: 90,
      },
    });

    const validDoc = await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [createAmount(200)],
      classification: "medical_bill",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    const created = await generator.generateDraftClaims("forever", new Date("2026-01-16"));

    expect(created).toHaveLength(1);
    expect(created[0]?.primaryDocumentId).toBe(validDoc.id);
  });

  it("respects the requested date range", async () => {
    const { documents, generator } = await loadModules();

    await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [createAmount(45)],
      classification: "medical_bill",
      medicalKeywords: [],
      date: new Date("2025-12-01"),
    });

    const recentDoc = await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [createAmount(95)],
      classification: "medical_bill",
      medicalKeywords: [],
      date: new Date("2026-01-12"),
    });

    const created = await generator.generateDraftClaims("last_week", new Date("2026-01-16"));

    expect(created).toHaveLength(1);
    expect(created[0]?.primaryDocumentId).toBe(recentDoc.id);
  });

  it("prefers payment override over detected amounts", async () => {
    const { documents, generator } = await loadModules();

    const doc = await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [createAmount(8000)], // OCR misread 80 as 8000
      classification: "medical_bill",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    // Set the correct override
    await documents.setPaymentOverride(doc.id, { amount: 80, currency: "EUR", note: "OCR misread" });

    const created = await generator.generateDraftClaims("forever", new Date("2026-01-16"));

    expect(created).toHaveLength(1);
    const draft = created[0]!;
    expect(draft.payment.amount).toBe(80);
    expect(draft.payment.currency).toBe("EUR");
    expect(draft.payment.source).toBe("override");
    expect(draft.payment.confidence).toBe(100); // Manual override is 100% confidence
  });

  it("creates draft claim from override-only document (no detected amounts)", async () => {
    const { documents, generator } = await loadModules();

    const doc = await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [], // No detected amounts at all
      classification: "medical_bill",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    // Add override to make it draftable
    await documents.setPaymentOverride(doc.id, { amount: 150, currency: "USD" });

    const created = await generator.generateDraftClaims("forever", new Date("2026-01-16"));

    expect(created).toHaveLength(1);
    expect(created[0]?.payment.amount).toBe(150);
    expect(created[0]?.payment.source).toBe("override");
  });

  it("does not create drafts for documents without any payment signal", async () => {
    const { documents, generator } = await loadModules();

    await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [],
      classification: "correspondence",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    const created = await generator.generateDraftClaims("forever", new Date("2026-01-16"));

    expect(created).toHaveLength(0);
  });

  it("marks detected amounts with source = detected", async () => {
    const { documents, generator } = await loadModules();

    await documents.createMedicalDocument({
      sourceType: "attachment",
      detectedAmounts: [createAmount(250)],
      classification: "medical_bill",
      medicalKeywords: [],
      date: new Date("2026-01-10"),
    });

    const created = await generator.generateDraftClaims("forever", new Date("2026-01-16"));

    expect(created).toHaveLength(1);
    expect(created[0]?.payment.source).toBe("detected");
  });
});
