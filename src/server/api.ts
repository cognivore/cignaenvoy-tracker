/**
 * API Server
 *
 * Simple HTTP server that exposes the storage layer and services
 * for the frontend to consume.
 */

import * as http from "node:http";
import * as url from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  claimsStorage as scrapedClaimsStorage,
  archiveClaim as archiveScrapedClaim,
  unarchiveClaim as unarchiveScrapedClaim,
  getArchivedClaims as getArchivedScrapedClaims,
  getActiveClaims as getActiveScrapedClaims,
} from "../storage/claims.js";
import {
  submittedClaimsStorage,
  createSubmittedClaim,
  updateSubmittedClaim,
  archiveSubmittedClaim,
  unarchiveSubmittedClaim,
  getArchivedSubmittedClaims,
  getActiveSubmittedClaims,
} from "../storage/submitted-claims.js";
import {
  documentsStorage,
  getMedicalBills,
  getActiveDocuments,
  getArchivedDocuments,
  setPaymentOverride,
  archiveDocument,
  unarchiveDocument,
  createMedicalDocument,
  updateMedicalDocument,
} from "../storage/documents.js";
import {
  assignmentsStorage,
  getCandidateAssignments,
  getConfirmedAssignments,
  confirmAssignment,
  rejectAssignment,
} from "../storage/assignments.js";
import {
  draftClaimsStorage,
  updateDraftClaim,
  archiveDraftClaim,
  unarchiveDraftClaim,
  markDraftClaimPending,
  getArchivedDraftClaims,
  getActiveDraftClaims,
} from "../storage/draft-claims.js";
import {
  archiveRulesStorage,
  createArchiveRule,
  updateArchiveRule,
} from "../storage/archive-rules.js";
import {
  patientsStorage,
  createPatient,
  updatePatient,
  findPatientByCignaId,
  archivePatient,
  unarchivePatient,
  getArchivedPatients,
  getActivePatients,
} from "../storage/patients.js";
import {
  illnessesStorage,
  createIllness,
  updateIllness,
  getIllnessesForPatient,
  getActiveIllnesses,
  addRelevantAccounts,
  archiveIllness,
  unarchiveIllness,
  getArchivedIllnesses,
  getActiveIllnessesAll,
} from "../storage/illnesses.js";
import { ensureStorageDirs, getStorageBackend, getStatsFast } from "../storage/index.js";
import { DocumentProcessor } from "../services/document-processor.js";
import { generateDraftClaims } from "../services/draft-claim-generator.js";
import { promoteDocumentToDraftClaim, propagateDocumentPaymentToDrafts } from "../services/draft-claim-promoter.js";
import { Matcher } from "../services/matcher.js";
import {
  matchAllScrapedClaimsToDrafts,
  getMatchCandidatesForReview,
  confirmMatch,
  autoLinkBySubmissionNumber,
  autoLinkHighConfidenceMatches,
  linkDraftToSubmissionNumber,
  getLinkedDraftClaims,
} from "../services/draft-claim-matcher.js";
import { applyArchiveRuleToExistingDocuments } from "../services/archive-rules.js";
import { dedupeIds } from "../services/ids.js";
import {
  runDocumentProcessing,
  startDocumentProcessingSchedule,
} from "../services/document-processing-runner.js";
import { CignaScraper } from "../services/cigna-scraper.js";
import { CignaSubmitter } from "../services/cigna-submit.js";
import { extractAndPrepareAccounts } from "../services/account-extractor.js";
import { generateDoctorNotesPdf } from "../services/pdf-generator.js";
import type { CreatePatientInput, UpdatePatientInput } from "../types/patient.js";
import type { CreateIllnessInput, UpdateIllnessInput } from "../types/illness.js";
import type { DraftClaim, DraftClaimRange, DraftClaimDateSource, DraftClaimStatus } from "../types/draft-claim.js";
import type { Claim } from "../types/claim.js";
import type { MedicalDocument } from "../types/medical-document.js";
import type {
  CreateArchiveRuleInput,
  UpdateArchiveRuleInput,
} from "../types/archive-rule.js";

const PORT = 3001;

/**
 * Map city/location names to proper country names for Cigna
 */
function resolveCountry(location: string | undefined): string {
  if (!location) return "Unknown";

  const locationLower = location.toLowerCase();

  // Map common locations to countries
  const locationToCountry: Record<string, string> = {
    "london": "United Kingdom",
    "uk": "United Kingdom",
    "gb": "United Kingdom",
    "england": "United Kingdom",
    "scotland": "United Kingdom",
    "wales": "United Kingdom",
    "northern ireland": "United Kingdom",
    "france": "France",
    "fr": "France",
    "paris": "France",
    "croatia": "Croatia",
    "hr": "Croatia",
    "zagreb": "Croatia",
    "germany": "Germany",
    "de": "Germany",
    "berlin": "Germany",
    "munich": "Germany",
    "usa": "United States",
    "us": "United States",
    "united states": "United States",
    "new york": "United States",
    "los angeles": "United States",
  };

  // Check for exact match first
  if (locationToCountry[locationLower]) {
    return locationToCountry[locationLower];
  }

  // Check if location contains a known key
  for (const [key, country] of Object.entries(locationToCountry)) {
    if (locationLower.includes(key)) {
      return country;
    }
  }

  // Return original if it looks like a full country name
  if (location.length > 3 && !location.includes(" ")) {
    return location;
  }

  return location;
}

type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
  body?: unknown
) => Promise<unknown>;

const routes = {
  GET: {} as Record<string, RouteHandler>,
  POST: {} as Record<string, RouteHandler>,
  PUT: {} as Record<string, RouteHandler>,
  PATCH: {} as Record<string, RouteHandler>,
  DELETE: {} as Record<string, RouteHandler>,
};

// =============================================
// REQUEST/RESPONSE HELPERS
// =============================================

/** Send JSON response with CORS headers */
function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

/** Parse JSON body from request */
async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

// =============================================
// VALIDATION HELPERS
// =============================================

type HttpError = { status: number; message: string };

/** Throw an HTTP error */
function httpError(status: number, message: string): never {
  throw { status, message } as HttpError;
}

/** Require that an entity exists, or throw 404 */
function requireEntity<T>(
  entity: T | null | undefined,
  name: string
): asserts entity is T {
  if (!entity) httpError(404, `${name} not found`);
}

/** Require that body fields are present, or throw 400 */
function requireFields<T extends Record<string, unknown>>(
  body: T,
  fields: (keyof T)[],
  message?: string
): void {
  const missing = fields.filter((f) => !body[f]);
  if (missing.length > 0) {
    httpError(400, message ?? `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required`);
  }
}

/** Parse and validate a date string, or throw 400 */
function parseDate(value: string, fieldName = "date"): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    httpError(400, `${fieldName} must be a valid date`);
  }
  return parsed;
}

// =============================================
// DOMAIN HELPERS
// =============================================

/** Extract the earliest treatment date from calendar documents */
function getCalendarTreatmentDate(calendarDocs: MedicalDocument[]): Date | null {
  const dates = calendarDocs
    .map((doc) => doc.calendarStart ?? doc.date)
    .filter((date): date is Date => !!date)
    .map((date) => new Date(date));

  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime())));
}

/** Resolve treatment date from manual input or calendar documents */
async function resolveTreatmentDate(
  manualDate: string | undefined,
  calendarIds: string[]
): Promise<{ finalDate: Date; dateSource: DraftClaimDateSource }> {
  // Manual date takes precedence
  if (manualDate) {
    return { finalDate: parseDate(manualDate, "treatmentDate"), dateSource: "manual" };
  }

  // Calendar-based date
  if (calendarIds.length > 0) {
    const calendarDocs = await Promise.all(calendarIds.map((id) => documentsStorage.get(id)));

    if (calendarDocs.some((doc) => !doc)) {
      httpError(404, "Calendar document not found");
    }

    const validDocs = calendarDocs.filter((doc): doc is MedicalDocument => !!doc);

    if (validDocs.some((doc) => doc.sourceType !== "calendar")) {
      httpError(400, "calendarDocumentIds must be calendar documents");
    }

    const derivedDate = getCalendarTreatmentDate(validDocs);
    if (!derivedDate) {
      httpError(400, "No usable dates found in calendar documents");
    }

    return { finalDate: derivedDate, dateSource: "calendar" };
  }

  httpError(400, "treatmentDate or calendarDocumentIds is required to accept a draft claim");
}

// =============================================
// CLAIMS ROUTES
// =============================================

routes.GET["/api/claims"] = async () => submittedClaimsStorage.getAll();

routes.GET["/api/claims/:id"] = async (_req, _res, params) => {
  const claim = await submittedClaimsStorage.get(params.id!);
  requireEntity(claim, "Claim");
  return claim;
};

routes.GET["/api/claims/archived"] = async () => getArchivedSubmittedClaims();

routes.GET["/api/claims/active"] = async () => getActiveSubmittedClaims();

routes.GET["/api/claims/by-draft/:draftId"] = async (_req, _res, params) => {
  const all = await submittedClaimsStorage.getAll();
  const claim = all.find((c: any) => c.draftClaimId === params.draftId);
  if (!claim) httpError(404, "No claim found for this draft");
  return claim;
};

/** Archive or unarchive a claim */
routes.PUT["/api/claims/:id/archive"] = async (_req, _res, params, body) => {
  const { archived } = body as { archived?: boolean };

  if (archived === undefined) {
    httpError(400, "archived is required");
  }

  const claim = await submittedClaimsStorage.get(params.id!);
  requireEntity(claim, "Claim");

  if (archived) {
    const updated = await archiveSubmittedClaim(params.id!);
    requireEntity(updated, "Claim");
    return updated;
  }

  const updated = await unarchiveSubmittedClaim(params.id!);
  requireEntity(updated, "Claim");
  return updated;
};

// =============================================
// SCRAPED CLAIMS ROUTES
// =============================================

routes.GET["/api/scraped-claims"] = async () => scrapedClaimsStorage.getAll();

routes.GET["/api/scraped-claims/:id"] = async (_req, _res, params) => {
  const claim = await scrapedClaimsStorage.get(params.id!);
  requireEntity(claim, "Scraped claim");
  return claim;
};

routes.GET["/api/scraped-claims/archived"] = async () => getArchivedScrapedClaims();

routes.GET["/api/scraped-claims/active"] = async () => getActiveScrapedClaims();

/** Archive or unarchive a scraped claim */
routes.PUT["/api/scraped-claims/:id/archive"] = async (_req, _res, params, body) => {
  const { archived } = body as { archived?: boolean };

  if (archived === undefined) {
    httpError(400, "archived is required");
  }

  const claim = await scrapedClaimsStorage.get(params.id!);
  requireEntity(claim, "Scraped claim");

  if (archived) {
    const updated = await archiveScrapedClaim(params.id!);
    requireEntity(updated, "Scraped claim");
    return updated;
  }

  const updated = await unarchiveScrapedClaim(params.id!);
  requireEntity(updated, "Scraped claim");
  return updated;
};

// =============================================
// DOCUMENTS ROUTES
// =============================================

/** Strip heavy text fields from documents for list responses. */
function slimDocument(doc: MedicalDocument) {
  const { ocrText, ...rest } = doc;
  return rest;
}

/**
 * Time-based response cache for expensive list endpoints.
 * Avoids re-serializing the same 3k+ document list on every poll.
 */
const responseCache = new Map<string, { data: unknown; expires: number }>();
function cachedHandler<T>(key: string, ttlMs: number, handler: () => Promise<T>): () => Promise<T> {
  return async () => {
    const now = Date.now();
    const entry = responseCache.get(key);
    if (entry && entry.expires > now) return entry.data as T;
    const data = await handler();
    responseCache.set(key, { data, expires: now + ttlMs });
    return data;
  };
}

function invalidateCache(prefix: string) {
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}

routes.GET["/api/documents"] = async () => {
  const all = await documentsStorage.getAll();
  return all.map(slimDocument);
};

routes.GET["/api/documents/:id"] = async (_req, _res, params) => {
  const doc = await documentsStorage.get(params.id!);
  requireEntity(doc, "Document");
  return doc;
};

routes.GET["/api/documents/active"] = cachedHandler("docs:active", 10_000, async () => {
  const docs = await getActiveDocuments();
  return docs.map(slimDocument);
});

routes.GET["/api/documents/archived"] = cachedHandler("docs:archived", 10_000, async () => {
  const docs = await getArchivedDocuments();
  return docs.map(slimDocument);
});

routes.GET["/api/documents/medical-bills"] = async () => {
  const bills = await getMedicalBills();
  return bills.map(slimDocument);
};

/** Set or clear a manual payment override for a document */
routes.PUT["/api/documents/:id/payment-override"] = async (_req, _res, params, body) => {
  const { amount, currency, note, clear } = body as {
    amount?: number;
    currency?: string;
    note?: string;
    clear?: boolean;
  };

  const doc = await documentsStorage.get(params.id!);
  requireEntity(doc, "Document");

  // Clear the override if requested
  if (clear) {
    const updated = await setPaymentOverride(params.id!, null);
    requireEntity(updated, "Document");
    await propagateDocumentPaymentToDrafts(params.id!);
    return updated;
  }

  // Validate override fields
  if (amount === undefined || !currency) {
    httpError(400, "amount and currency are required to set a payment override");
  }

  if (typeof amount !== "number" || amount < 0) {
    httpError(400, "amount must be a non-negative number");
  }

  const overrideInput = {
    amount,
    currency,
    ...(note !== undefined && { note }),
  };

  const updated = await setPaymentOverride(params.id!, overrideInput);
  requireEntity(updated, "Document");
  await propagateDocumentPaymentToDrafts(params.id!);
  return updated;
};

/** Archive or unarchive a document */
routes.PUT["/api/documents/:id/archive"] = async (_req, _res, params, body) => {
  const { archived, reason, ruleId } = body as {
    archived?: boolean;
    reason?: string;
    ruleId?: string;
  };

  if (archived === undefined) {
    httpError(400, "archived is required");
  }

  const doc = await documentsStorage.get(params.id!);
  requireEntity(doc, "Document");

  if (archived) {
    const updated = await archiveDocument(params.id!, { reason, ruleId });
    requireEntity(updated, "Document");
    invalidateCache("docs:");
    return updated;
  }

  const updated = await unarchiveDocument(params.id!);
  requireEntity(updated, "Document");
  invalidateCache("docs:");
  return updated;
};

/** Promote a document (and its email group) into a draft claim */
routes.POST["/api/documents/:id/promote"] = async (_req, _res, params, body) => {
  const document = await documentsStorage.get(params.id!);
  requireEntity(document, "Document");

  if (document.archivedAt) {
    httpError(400, "Cannot promote an archived document");
  }

  const { force } = (body ?? {}) as { force?: boolean };
  return promoteDocumentToDraftClaim(document, { force: !!force });
};

/** Reprocess a document to re-extract amounts and metadata */
routes.POST["/api/documents/:id/reprocess"] = async (_req, _res, params) => {
  const document = await documentsStorage.get(params.id!);
  requireEntity(document, "Document");

  if (!document.attachmentPath) {
    httpError(400, "Document has no attachment to process");
  }

  console.log(`Reprocessing document ${document.id}: ${document.filename}`);

  // Import QweN client and helpers
  const { qwenClient } = await import("../services/qwen-client.js");
  const { extractAmounts, classifyDocument, extractMedicalKeywords } = await import("../services/document-processor.js");

  // Re-run OCR on the attachment
  console.log(`  Running OCR on: ${document.attachmentPath}`);
  const ocrResult = await qwenClient.ocrDocument(document.attachmentPath);

  if (ocrResult.status !== "success" || !ocrResult.text) {
    console.error(`  OCR failed:`, ocrResult.error);
    httpError(500, `OCR failed: ${ocrResult.error ?? "Unknown error"}`);
  }

  const ocrText = ocrResult.text;
  console.log(`  OCR extracted ${ocrText.length} characters`);

  // Extract amounts from OCR text
  const detectedAmounts = extractAmounts(ocrText);
  console.log(`  Detected ${detectedAmounts.length} amounts:`, detectedAmounts.map(a => `${a.value} ${a.currency}`));

  // Pick the best amount (highest confidence or largest)
  const bestAmount = detectedAmounts.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return b.value - a.value;
  })[0];

  // Update the document
  const updates: Parameters<typeof updateMedicalDocument>[1] = {
    ocrText,
    ocrCharCount: ocrText.length,
    detectedAmounts,
    classification: classifyDocument(ocrText, document.subject ?? ""),
    medicalKeywords: extractMedicalKeywords(ocrText),
  };

  if (bestAmount) {
    updates.extractedAmount = bestAmount.value;
    updates.extractedCurrency = bestAmount.currency;
    console.log(`  Best amount: ${bestAmount.value} ${bestAmount.currency}`);
  } else {
    console.log(`  No amounts detected in document`);
  }

  const updated = await updateMedicalDocument(document.id, updates);
  console.log(`  Document updated successfully`);

  const propagated = await propagateDocumentPaymentToDrafts(document.id);
  if (propagated.length > 0) {
    console.log(`  Propagated payment to ${propagated.length} draft claim(s)`);
  }

  return updated;
};

// =============================================
// ARCHIVE RULES ROUTES
// =============================================

routes.GET["/api/archive-rules"] = async () => archiveRulesStorage.getAll();

routes.POST["/api/archive-rules"] = async (_req, _res, _params, body) => {
  const input = body as CreateArchiveRuleInput & { applyToExisting?: boolean };
  const name = input.name?.trim();
  if (!name) httpError(400, "name is required");

  const fromContains = input.fromContains?.trim();
  const subjectContains = input.subjectContains?.trim();
  const attachmentNameContains = input.attachmentNameContains?.trim();
  if (!fromContains && !subjectContains && !attachmentNameContains) {
    httpError(400, "At least one match condition is required");
  }

  const rule = await createArchiveRule({
    name,
    enabled: input.enabled ?? true,
    ...(fromContains && { fromContains }),
    ...(subjectContains && { subjectContains }),
    ...(attachmentNameContains && { attachmentNameContains }),
  });

  // Apply to existing documents in background (fire-and-forget) to avoid timeout
  if (input.applyToExisting ?? true) {
    applyArchiveRuleToExistingDocuments(rule).catch((err) =>
      console.error("Failed to apply archive rule to existing docs:", err)
    );
  }

  return rule;
};

routes.PUT["/api/archive-rules/:id"] = async (_req, _res, params, body) => {
  const updates = body as UpdateArchiveRuleInput & { applyToExisting?: boolean };
  const existing = await archiveRulesStorage.get(params.id!);
  requireEntity(existing, "Archive rule");

  const normalizeOptional = (value?: string | null) => {
    if (value === undefined) return undefined;
    if (value === null) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const normalized: UpdateArchiveRuleInput = {
    ...(updates.name !== undefined && { name: updates.name.trim() }),
    ...(updates.enabled !== undefined && { enabled: updates.enabled }),
    ...(updates.fromContains !== undefined && {
      fromContains: normalizeOptional(updates.fromContains),
    }),
    ...(updates.subjectContains !== undefined && {
      subjectContains: normalizeOptional(updates.subjectContains),
    }),
    ...(updates.attachmentNameContains !== undefined && {
      attachmentNameContains: normalizeOptional(updates.attachmentNameContains),
    }),
  };

  if (normalized.name !== undefined && !normalized.name) {
    httpError(400, "name is required");
  }

  const proposed = {
    ...existing,
    ...normalized,
  };

  if (
    !proposed.fromContains &&
    !proposed.subjectContains &&
    !proposed.attachmentNameContains
  ) {
    httpError(400, "At least one match condition is required");
  }

  const updated = await updateArchiveRule(params.id!, normalized);
  requireEntity(updated, "Archive rule");

  // Apply to existing documents in background (fire-and-forget) to avoid timeout
  if (updates.applyToExisting) {
    applyArchiveRuleToExistingDocuments(updated).catch((err) =>
      console.error("Failed to apply archive rule to existing docs:", err)
    );
  }

  return updated;
};

routes.DELETE["/api/archive-rules/:id"] = async (_req, _res, params) => {
  const success = await archiveRulesStorage.delete(params.id!);
  return { success };
};

// =============================================
// PATIENTS ROUTES
// =============================================

routes.GET["/api/patients"] = async () => patientsStorage.getAll();

routes.GET["/api/patients/:id"] = async (_req, _res, params) => {
  const patient = await patientsStorage.get(params.id!);
  requireEntity(patient, "Patient");
  return patient;
};

routes.POST["/api/patients"] = async (_req, _res, _params, body) => {
  const input = body as CreatePatientInput;
  requireFields(input, ["cignaId", "name"]);
  return createPatient(input);
};

routes.PUT["/api/patients/:id"] = async (_req, _res, params, body) => {
  const updates = body as UpdatePatientInput;
  const patient = await updatePatient(params.id!, updates);
  requireEntity(patient, "Patient");
  return patient;
};

routes.GET["/api/patients/by-cigna-id/:cignaId"] = async (_req, _res, params) => {
  const patient = await findPatientByCignaId(params.cignaId!);
  requireEntity(patient, "Patient");
  return patient;
};

routes.GET["/api/patients/archived"] = async () => getArchivedPatients();

routes.GET["/api/patients/active"] = async () => getActivePatients();

/** Archive or unarchive a patient */
routes.PUT["/api/patients/:id/archive"] = async (_req, _res, params, body) => {
  const { archived } = body as { archived?: boolean };

  if (archived === undefined) {
    httpError(400, "archived is required");
  }

  const patient = await patientsStorage.get(params.id!);
  requireEntity(patient, "Patient");

  if (archived) {
    const updated = await archivePatient(params.id!);
    requireEntity(updated, "Patient");
    return updated;
  }

  const updated = await unarchivePatient(params.id!);
  requireEntity(updated, "Patient");
  return updated;
};

// =============================================
// ILLNESSES ROUTES
// =============================================

routes.GET["/api/illnesses"] = async () => illnessesStorage.getAll();

routes.GET["/api/illnesses/:id"] = async (_req, _res, params) => {
  const illness = await illnessesStorage.get(params.id!);
  requireEntity(illness, "Illness");
  return illness;
};

routes.POST["/api/illnesses"] = async (_req, _res, _params, body) => {
  const input = body as CreateIllnessInput;
  requireFields(input, ["patientId", "name", "type"]);
  return createIllness(input);
};

routes.PUT["/api/illnesses/:id"] = async (_req, _res, params, body) => {
  const updates = body as UpdateIllnessInput;
  const illness = await updateIllness(params.id!, updates);
  requireEntity(illness, "Illness");
  return illness;
};

routes.GET["/api/patients/:patientId/illnesses"] = async (_req, _res, params) =>
  getIllnessesForPatient(params.patientId!);

routes.GET["/api/patients/:patientId/illnesses/active"] = async (_req, _res, params) =>
  getActiveIllnesses(params.patientId!);

routes.GET["/api/illnesses/archived"] = async () => getArchivedIllnesses();

routes.GET["/api/illnesses/active"] = async () => getActiveIllnessesAll();

/** Archive or unarchive an illness */
routes.PUT["/api/illnesses/:id/archive"] = async (_req, _res, params, body) => {
  const { archived } = body as { archived?: boolean };

  if (archived === undefined) {
    httpError(400, "archived is required");
  }

  const illness = await illnessesStorage.get(params.id!);
  requireEntity(illness, "Illness");

  if (archived) {
    const updated = await archiveIllness(params.id!);
    requireEntity(updated, "Illness");
    return updated;
  }

  const updated = await unarchiveIllness(params.id!);
  requireEntity(updated, "Illness");
  return updated;
};

// =============================================
// ASSIGNMENTS ROUTES
// =============================================

routes.GET["/api/assignments"] = async () => assignmentsStorage.getAll();

routes.GET["/api/assignments/candidates"] = async () => getCandidateAssignments();

routes.GET["/api/assignments/confirmed"] = async () => getConfirmedAssignments();

routes.POST["/api/assignments/:id/confirm"] = async (_req, _res, params, body) => {
  const { illnessId, reviewNotes } = body as { illnessId?: string; reviewNotes?: string };

  requireFields({ illnessId }, ["illnessId"], "illnessId is required to confirm an assignment");

  const illness = await illnessesStorage.get(illnessId!);
  requireEntity(illness, "Illness");

  const existingAssignment = await assignmentsStorage.get(params.id!);
  requireEntity(existingAssignment, "Assignment");

  // Extract and add relevant accounts to the illness
  const document = await documentsStorage.get(existingAssignment.documentId);
  if (document) {
    const accounts = extractAndPrepareAccounts(document);
    if (accounts.length > 0) {
      await addRelevantAccounts(illnessId!, accounts);
    }
  }

  const assignment = await confirmAssignment(params.id!, illnessId!, undefined, reviewNotes);
  requireEntity(assignment, "Assignment");
  return assignment;
};

routes.POST["/api/assignments/:id/reject"] = async (_req, _res, params, body) => {
  const { reviewNotes } = body as { reviewNotes?: string };
  const assignment = await rejectAssignment(params.id!, reviewNotes);
  requireEntity(assignment, "Assignment");
  return assignment;
};

/** Preview which accounts would be extracted from an assignment's document */
routes.GET["/api/assignments/:id/preview-accounts"] = async (_req, _res, params) => {
  const assignment = await assignmentsStorage.get(params.id!);
  requireEntity(assignment, "Assignment");

  const document = await documentsStorage.get(assignment.documentId);
  if (!document) return { accounts: [] };

  return { accounts: extractAndPrepareAccounts(document) };
};

// =============================================
// DRAFT CLAIMS ROUTES
// =============================================

routes.GET["/api/draft-claims"] = async () => draftClaimsStorage.getAll();

routes.POST["/api/draft-claims/generate"] = async (_req, _res, _params, body) => {
  const { range } = body as { range?: DraftClaimRange };
  const validRanges: DraftClaimRange[] = ["forever", "last_month", "last_week"];
  const selectedRange: DraftClaimRange = validRanges.includes(range as DraftClaimRange)
    ? (range as DraftClaimRange)
    : "forever";

  const drafts = await generateDraftClaims(selectedRange);
  return { created: drafts.length, drafts };
};

routes.POST["/api/draft-claims/:id/accept"] = async (_req, _res, params, body) => {
  const {
    illnessId,
    doctorNotes,
    calendarDocumentIds,
    treatmentDate,
    paymentProofDocumentIds,
    paymentProofText,
  } = body as {
    illnessId?: string;
    doctorNotes?: string;
    calendarDocumentIds?: string[];
    treatmentDate?: string;
    paymentProofDocumentIds?: string[];
    paymentProofText?: string;
  };

  requireFields({ illnessId }, ["illnessId"], "illnessId is required to accept a draft claim");

  const trimmedNotes = doctorNotes?.trim();
  if (!trimmedNotes) httpError(400, "doctorNotes is required to accept a draft claim");

  const draft = await draftClaimsStorage.get(params.id!);
  requireEntity(draft, "Draft claim");

  const draftCountry = draft.submission?.country?.trim();
  if (!draftCountry) {
    httpError(400, "country is required to accept a draft claim");
  }

  const illness = await illnessesStorage.get(illnessId!);
  requireEntity(illness, "Illness");

  const calendarIds = Array.isArray(calendarDocumentIds)
    ? calendarDocumentIds.filter(Boolean)
    : [];
  const proofIdsInput = Array.isArray(paymentProofDocumentIds)
    ? paymentProofDocumentIds.filter(Boolean)
    : [];
  const trimmedProofText = paymentProofText?.trim() ?? "";
  const existingProofIds = draft.paymentProofDocumentIds ?? [];
  const finalProofIds = proofIdsInput.length > 0 ? proofIdsInput : existingProofIds;
  const finalProofText = trimmedProofText || draft.paymentProofText;

  if (finalProofIds.length === 0 && !finalProofText) {
    httpError(400, "payment proof is required to accept a draft claim");
  }

  if (finalProofIds.length > 0) {
    const proofDocs = await Promise.all(
      finalProofIds.map((id) => documentsStorage.get(id))
    );
    if (proofDocs.some((doc) => !doc)) {
      httpError(404, "Payment proof document not found");
    }
    const validProofDocs = proofDocs.filter((doc): doc is MedicalDocument => !!doc);
    if (validProofDocs.some((doc) => doc.sourceType === "calendar")) {
      httpError(400, "Payment proof cannot be a calendar document");
    }
  }

  // Determine treatment date
  const { finalDate, dateSource } = await resolveTreatmentDate(treatmentDate, calendarIds);

  const documentIds = dedupeIds([
    ...draft.documentIds,
    ...calendarIds,
    ...finalProofIds,
  ]);

  const updated = await updateDraftClaim(params.id!, {
    status: "accepted",
    illnessId: illnessId!,
    doctorNotes: trimmedNotes,
    treatmentDate: finalDate,
    treatmentDateSource: dateSource,
    ...(calendarIds.length > 0 && { calendarDocumentIds: calendarIds }),
    ...(finalProofIds.length > 0 && { paymentProofDocumentIds: finalProofIds }),
    ...(finalProofText && { paymentProofText: finalProofText }),
    documentIds,
    acceptedAt: new Date(),
  });

  requireEntity(updated, "Draft claim");
  return updated;
};

routes.POST["/api/draft-claims/:id/submit"] = async (_req, _res, params, body) => {
  const {
    cignaId: bodyId,
    password: bodyPw,
    totpSecret: bodyTotp,
    headless: bodyHeadless,
    pauseBeforeSubmit: bodyPause,
  } = body as {
    cignaId?: string;
    password?: string;
    totpSecret?: string;
    headless?: boolean;
    pauseBeforeSubmit?: boolean;
  };

  const cignaId = bodyId ?? process.env.CIGNA_ID;
  const password = bodyPw ?? process.env.CIGNA_PASSWORD;
  const totpSecret = bodyTotp ?? process.env.CIGNA_TOTP_SECRET;
  const headless = bodyHeadless ?? false; // Default: visible browser
  const pauseBeforeSubmit = bodyPause ?? false; // Default: submit automatically

  if (!cignaId || !password) {
    httpError(400, "cignaId and password required (via body or CIGNA_ID/CIGNA_PASSWORD env vars)");
  }

  const draft = await draftClaimsStorage.get(params.id!);
  requireEntity(draft, "Draft claim");

  if (draft.status !== "accepted") {
    httpError(400, "Draft claim must be accepted before submission");
  }

  if (!draft.illnessId) {
    httpError(400, "Draft claim is missing illness");
  }

  const illness = await illnessesStorage.get(draft.illnessId);
  requireEntity(illness, "Illness");

  const patient = await patientsStorage.get(illness.patientId);
  requireEntity(patient, "Patient");

  // For Cigna submission, upload ALL attachments and ALL proofs.
  // This includes invoices/bills from documentIds and payment proofs.
  const allDocIds = dedupeIds([
    ...(draft.documentIds ?? []),
    ...(draft.paymentProofDocumentIds ?? []),
  ]);
  console.log(`Submission: collecting documents from ${allDocIds.length} IDs:`, allDocIds);
  const allDocs = await Promise.all(allDocIds.map((id) => documentsStorage.get(id)));
  const attachments: { filePath: string; fileName: string }[] = allDocs
    .filter((doc): doc is MedicalDocument => !!doc)
    .filter((doc) => {
      if (!doc.attachmentPath) {
        console.log(`  Skipping ${doc.id} (${doc.filename ?? doc.subject ?? 'no name'}): no attachmentPath`);
        return false;
      }
      console.log(`  Including ${doc.id}: ${doc.filename} -> ${doc.attachmentPath}`);
      return true;
    })
    .map((doc) => ({
      filePath: doc.attachmentPath!,
      fileName: doc.filename ?? path.basename(doc.attachmentPath!),
    }));
  console.log(`Submission: ${attachments.length} attachments to upload:`, attachments.map(a => a.fileName));

  // Generate a PDF from doctor notes for the progress report.
  // Cigna often requires a progress report, so we render the notes as a properly
  // formatted PDF named YYYYMMDD_Doctor_Notes.pdf
  if (draft.doctorNotes?.trim()) {
    const treatmentDate = draft.treatmentDate
      ? new Date(draft.treatmentDate)
      : new Date();

    const notesPdf = await generateDoctorNotesPdf({
      doctorNotes: draft.doctorNotes,
      treatmentDate,
      patientName: patient.name,
      illnessName: illness.name,
      amount: draft.payment.amount,
      currency: draft.payment.currency,
    });

    attachments.push({
      filePath: notesPdf.filePath,
      fileName: notesPdf.fileName,
    });

    console.log(`Generated doctor notes PDF: ${notesPdf.fileName}`);
  }

  const submission = draft.submission ?? {};
  const submissionCountry = submission.country?.trim();
  if (!submissionCountry) {
    httpError(400, "country is required to submit a draft claim");
  }
  const submittedSymptoms = submission.symptoms?.filter((symptom) => symptom.name?.trim()) ?? [];
  const mappedSymptom = illness.cignaSymptom?.trim();
  const mappedDiagnosis = illness.cignaDescription?.trim();
  const hasMapping = !!mappedSymptom && !!mappedDiagnosis;
  if (submittedSymptoms.length === 0 && !hasMapping) {
    httpError(400, "Cigna symptom and diagnosis mapping are required for submission");
  }
  const resolvedSymptoms = hasMapping
    ? [
      {
        name: mappedSymptom!,
        description: mappedSymptom!,
      },
      {
        name: mappedDiagnosis!,
        description: mappedDiagnosis!,
      },
    ]
    : submittedSymptoms;
  const symptomNames = resolvedSymptoms.map((symptom) => symptom.name).filter(Boolean);
  const providerAccount =
    illness.relevantAccounts?.find((account) => account.role === "provider") ??
    illness.relevantAccounts?.[0];

  const claimInput = {
    draftClaimId: draft.id,
    patientId: patient.id,
    illnessId: illness.id,
    documentIds: draft.documentIds ?? [],
    proofDocumentIds: draft.paymentProofDocumentIds ?? [],
    treatmentIds: draft.documentIds ?? [],
    claimType: submission.claimType ?? "Medical",
    symptoms: resolvedSymptoms,
    totalAmount: draft.payment.amount,
    currency: draft.payment.currency,
    country: resolveCountry(submissionCountry),
    notes: draft.doctorNotes,
  };

  // Don't create a claim record yet - it will be created when matched with scraped claim
  // Just run the submitter to fill the form and stop at the review page

  void (async () => {
    const submitter = new CignaSubmitter({
      cignaId,
      password,
      ...(totpSecret && { totpSecret }),
      headless: false, // Always visible for manual submission
      pauseBeforeSubmit: true, // Will pause at review page
    });

    try {
      await submitter.run({
        claimType: claimInput.claimType,
        country: claimInput.country,
        symptoms: symptomNames,
        symptomMatchMode: "exact",
        providerName: submission.providerName ?? providerAccount?.name ?? providerAccount?.email,
        providerAddress: submission.providerAddress,
        providerCountry: submission.providerCountry ?? submissionCountry,
        progressReport: submission.progressReport ?? draft.doctorNotes,
        treatmentDate: draft.treatmentDate
          ? new Date(draft.treatmentDate).toISOString().slice(0, 10)
          : undefined,
        totalAmount: claimInput.totalAmount,
        currency: claimInput.currency,
        patientName: patient.name,
        documents: attachments,
      });

      // Browser stays open for manual submission - don't cleanup immediately
      // Wait 15 minutes for human to complete, then cleanup
      console.log("Browser ready for manual submission. Will auto-close in 15 minutes.");
      setTimeout(async () => {
        console.log("Auto-closing submission browser...");
        await submitter.cleanup();
      }, 15 * 60 * 1000);

    } catch (err) {
      console.error("Submission preparation failed:", err);
      await submitter.cleanup();
    }
  })();

  // Return the draft claim info - status stays "accepted" until matched with scraped claim
  return {
    message: "Browser opened for manual submission. Complete the submission on Cigna, then our scraper will match it.",
    draftId: draft.id,
    patient: patient.name,
    amount: claimInput.totalAmount,
    currency: claimInput.currency,
  };
};

routes.POST["/api/draft-claims/:id/reject"] = async (_req, _res, params) => {
  const updated = await updateDraftClaim(params.id!, {
    status: "rejected",
    rejectedAt: new Date(),
  });
  requireEntity(updated, "Draft claim");
  return updated;
};

routes.POST["/api/draft-claims/:id/pending"] = async (_req, _res, params) => {
  const updated = await markDraftClaimPending(params.id!);
  requireEntity(updated, "Draft claim");
  return updated;
};

/** Partial update for draft claim (auto-save) */
routes.PATCH["/api/draft-claims/:id"] = async (_req, _res, params, body) => {
  const {
    illnessId,
    doctorNotes,
    documentIds: inputDocumentIds,
    calendarDocumentIds,
    paymentProofDocumentIds,
    paymentProofText,
    submission,
  } = body as {
    illnessId?: string;
    doctorNotes?: string;
    documentIds?: string[];
    calendarDocumentIds?: string[];
    paymentProofDocumentIds?: string[];
    paymentProofText?: string;
    submission?: DraftClaim["submission"];
  };

  const draft = await draftClaimsStorage.get(params.id!);
  requireEntity(draft, "Draft claim");

  // Rejected drafts are read-only
  if (draft.status === "rejected") {
    httpError(400, "Cannot update rejected draft claims");
  }

  // Both pending and accepted drafts can be edited
  // (only truly locked when promoted to an actual Claim)

  const updates: Partial<DraftClaim> = {};

  if (illnessId !== undefined) {
    if (illnessId) {
      const illness = await illnessesStorage.get(illnessId);
      requireEntity(illness, "Illness");
    }
    updates.illnessId = illnessId || undefined;
  }

  if (doctorNotes !== undefined) {
    const trimmedNotes = doctorNotes.trim();
    updates.doctorNotes = trimmedNotes || undefined;
  }

  const calendarIds =
    calendarDocumentIds !== undefined
      ? Array.isArray(calendarDocumentIds)
        ? calendarDocumentIds.filter(Boolean)
        : []
      : undefined;
  const proofIds =
    paymentProofDocumentIds !== undefined
      ? Array.isArray(paymentProofDocumentIds)
        ? paymentProofDocumentIds.filter(Boolean)
        : []
      : undefined;
  const requestedDocIds =
    inputDocumentIds !== undefined
      ? Array.isArray(inputDocumentIds)
        ? inputDocumentIds.filter(Boolean)
        : []
      : undefined;

  // Validate documentIds if provided
  if (requestedDocIds !== undefined) {
    // 1. Primary document must always be included
    if (!requestedDocIds.includes(draft.primaryDocumentId)) {
      httpError(400, "documentIds must include the primary document");
    }

    // 2. All referenced docs must exist and not be archived
    const allDocs = await documentsStorage.getAll();
    const docsById = new Map(allDocs.map((doc) => [doc.id, doc]));
    const primaryDoc = docsById.get(draft.primaryDocumentId);
    const primaryEmailId = primaryDoc?.emailId;

    for (const docId of requestedDocIds) {
      const doc = docsById.get(docId);
      if (!doc) {
        httpError(400, `Document not found: ${docId}`);
      }
      if (doc.archivedAt) {
        httpError(400, `Cannot attach archived document: ${docId}`);
      }
      // 3. Non-manual uploads must share emailId with primary document
      if (doc.sourceType !== "manual_upload" && doc.sourceType !== "calendar") {
        if (primaryEmailId && doc.emailId !== primaryEmailId) {
          httpError(400, `Document ${docId} is not from the same email thread as the primary document`);
        }
      }
    }

    // 4. Auto-include calendarDocumentIds and paymentProofDocumentIds in documentIds
    const finalCalendarIds = calendarIds ?? draft.calendarDocumentIds ?? [];
    const finalProofIds = proofIds ?? draft.paymentProofDocumentIds ?? [];

    // Automatically add proof and calendar docs to documentIds (don't error)
    for (const id of [...finalCalendarIds, ...finalProofIds]) {
      if (!requestedDocIds.includes(id)) {
        requestedDocIds.push(id);
      }
    }

    updates.documentIds = dedupeIds(requestedDocIds);
  }

  if (calendarIds !== undefined) {
    updates.calendarDocumentIds = calendarIds;
  }

  if (proofIds !== undefined) {
    updates.paymentProofDocumentIds = proofIds;
  }

  if (paymentProofText !== undefined) {
    const trimmedProof = paymentProofText.trim();
    updates.paymentProofText = trimmedProof || undefined;
  }

  if (submission !== undefined || doctorNotes !== undefined) {
    const nextSubmission = {
      ...(draft.submission ?? {}),
      ...(submission ?? {}),
    };

    if (nextSubmission.country !== undefined) {
      const trimmedCountry = nextSubmission.country?.trim();
      nextSubmission.country = trimmedCountry || undefined;
    }

    if (doctorNotes !== undefined) {
      const trimmedNotes = doctorNotes.trim();
      nextSubmission.progressReport = trimmedNotes || undefined;
    }

    updates.submission = nextSubmission;

    if (submission?.progressReport !== undefined && doctorNotes === undefined) {
      const trimmedProgress = submission.progressReport.trim();
      updates.doctorNotes = trimmedProgress || undefined;
    }
  }

  // If documentIds was NOT explicitly provided, auto-update based on calendar/proof changes
  if (requestedDocIds === undefined && (calendarIds !== undefined || proofIds !== undefined)) {
    let nextDocumentIds = draft.documentIds;

    if (calendarIds !== undefined) {
      const removedCalendarIds = (draft.calendarDocumentIds ?? []).filter(
        (id) => !calendarIds.includes(id)
      );
      nextDocumentIds = nextDocumentIds.filter((id) => !removedCalendarIds.includes(id));
      nextDocumentIds = dedupeIds([...nextDocumentIds, ...calendarIds]);
    }

    if (proofIds !== undefined) {
      const removedProofIds = (draft.paymentProofDocumentIds ?? []).filter(
        (id) => !proofIds.includes(id)
      );
      nextDocumentIds = nextDocumentIds.filter((id) => !removedProofIds.includes(id));
      nextDocumentIds = dedupeIds([...nextDocumentIds, ...proofIds]);
    }

    nextDocumentIds = dedupeIds([draft.primaryDocumentId, ...nextDocumentIds]);
    updates.documentIds = nextDocumentIds;
  }

  const updated = await updateDraftClaim(params.id!, updates);
  requireEntity(updated, "Draft claim");
  return updated;
};

routes.POST["/api/draft-claims/run-matching"] = async () => {
  const drafts = await draftClaimsStorage.find((draft) => draft.status === "accepted");
  const documentIds = Array.from(new Set(drafts.flatMap((draft) => draft.documentIds)));

  if (documentIds.length === 0) return { created: 0, assignments: [] };

  const matcher = new Matcher();
  const assignments = await matcher.matchDocumentsByIds(documentIds);
  return { created: assignments.length, assignments };
};

routes.GET["/api/draft-claims/archived"] = async () => getArchivedDraftClaims();

routes.GET["/api/draft-claims/active"] = async () => getActiveDraftClaims();

/** Archive or unarchive a draft claim */
routes.PUT["/api/draft-claims/:id/archive"] = async (_req, _res, params, body) => {
  const { archived } = body as { archived?: boolean };

  if (archived === undefined) {
    httpError(400, "archived is required");
  }

  const draft = await draftClaimsStorage.get(params.id!);
  requireEntity(draft, "Draft claim");

  if (archived) {
    const updated = await archiveDraftClaim(params.id!);
    requireEntity(updated, "Draft claim");
    return updated;
  }

  const updated = await unarchiveDraftClaim(params.id!);
  requireEntity(updated, "Draft claim");
  return updated;
};

// =============================================
// PROCESSING ROUTES
// =============================================

routes.POST["/api/process/documents"] = async () => {
  const docs = await runDocumentProcessing("manual");
  return { processed: docs.length, documents: docs };
};

routes.POST["/api/process/match"] = async () => {
  const matcher = new Matcher();
  const assignments = await matcher.matchAllDocuments();
  return { created: assignments.length, assignments };
};

/** Match scraped claims to draft claims */
routes.POST["/api/process/match-drafts"] = async () => {
  const matches = await matchAllScrapedClaimsToDrafts();
  return { found: matches.length, matches };
};

/** Get draft-to-scraped match candidates for review */
routes.GET["/api/draft-claim-matches"] = async () => {
  const candidates = await getMatchCandidatesForReview();
  return candidates.map((c) => ({
    ...c,
    documents: c.documents.map(slimDocument),
  }));
};

/** Auto-link drafts to scraped claims (submission number + high-confidence heuristic) */
routes.POST["/api/draft-claim-matches/auto-link"] = async () => {
  // First, link by exact submission number (guaranteed)
  const linkedBySubmission = await autoLinkBySubmissionNumber();
  // Then, link high-confidence heuristic matches (amount + currency + patient + date)
  const linkedByHeuristic = await autoLinkHighConfidenceMatches();
  const totalLinked = linkedBySubmission + linkedByHeuristic;
  console.log(`Auto-linked: ${linkedBySubmission} by submission, ${linkedByHeuristic} by heuristic`);
  return { linked: totalLinked, linkedBySubmission, linkedByHeuristic };
};

/** Get all linked (submitted) draft claims with their scraped claim details */
routes.GET["/api/draft-claim-matches/linked"] = async () => {
  const results = await getLinkedDraftClaims();
  return results;
};

/** Accept a draft-to-scraped match - links draft to scraped claim */
routes.POST["/api/draft-claim-matches/:draftId/accept"] = async (_req, _res, params, body) => {
  const { scrapedClaimId } = body as { scrapedClaimId: string };

  if (!scrapedClaimId) {
    httpError(400, "scrapedClaimId is required");
  }

  const draft = await draftClaimsStorage.get(params.draftId!);
  requireEntity(draft, "Draft claim");

  const scrapedClaim = await scrapedClaimsStorage.get(scrapedClaimId);
  requireEntity(scrapedClaim, "Scraped claim");

  // Allow matching from both "accepted" and "submitted" (if re-linking)
  if (draft.status !== "accepted" && draft.status !== "submitted") {
    httpError(400, "Only accepted or submitted draft claims can be matched");
  }

  // Use confirmMatch to properly link draft to scraped claim
  // This stores submissionNumber, scrapedClaimId, cignaClaimNumber on the draft
  const updated = await confirmMatch(draft.id, scrapedClaimId);
  requireEntity(updated, "Updated draft claim");

  console.log(
    `Linked draft ${draft.id} → scraped claim ${scrapedClaim.submissionNumber} (${scrapedClaim.id})`
  );

  return {
    draft: updated,
    scrapedClaim,
    submissionNumber: scrapedClaim.submissionNumber,
    cignaClaimNumber: scrapedClaim.cignaClaimNumber,
  };
};

/** Store submission number on a draft claim (called after Cigna submission) */
routes.POST["/api/draft-claims/:id/link-submission"] = async (_req, _res, params, body) => {
  const { submissionNumber } = body as { submissionNumber: string };

  if (!submissionNumber) {
    httpError(400, "submissionNumber is required");
  }

  const updated = await linkDraftToSubmissionNumber(params.id!, submissionNumber);
  requireEntity(updated, "Draft claim");

  return updated;
};

routes.POST["/api/process/calendar"] = async () => {
  const processor = new DocumentProcessor({ processCalendar: true });
  const docs = await processor.processCalendarEventsFromSearch();
  return { processed: docs.length, documents: docs };
};

routes.POST["/api/process/scrape"] = async (_req, _res, _params, body) => {
  const { cignaId: bodyId, password: bodyPw, totpSecret: bodyTotp, headless: bodyHeadless } = body as {
    cignaId?: string;
    password?: string;
    totpSecret?: string;
    headless?: boolean;
  };

  const cignaId = bodyId ?? process.env.CIGNA_ID;
  const password = bodyPw ?? process.env.CIGNA_PASSWORD;
  const totpSecret = bodyTotp ?? process.env.CIGNA_TOTP_SECRET;
  const headless = bodyHeadless ?? true;

  if (!cignaId || !password) {
    httpError(400, "cignaId and password required (via body or CIGNA_ID/CIGNA_PASSWORD env vars)");
  }

  console.log(`Starting Cigna scrape (headless: ${headless})...`);

  const scraper = new CignaScraper({
    cignaId,
    password,
    ...(totpSecret && { totpSecret }),
    headless,
  });

  const claims = await scraper.run();
  console.log(`Scraped ${claims.length} claims from Cigna`);

  // AUTO-LINK: After scraping, automatically link any draft claims
  // 1. First by exact submission number (guaranteed)
  const linkedBySubmission = await autoLinkBySubmissionNumber();
  // 2. Then by high-confidence heuristic (amount + currency + patient + date)
  const linkedByHeuristic = await autoLinkHighConfidenceMatches();
  const totalLinked = linkedBySubmission + linkedByHeuristic;
  if (totalLinked > 0) {
    console.log(`Auto-linked ${totalLinked} draft claims (${linkedBySubmission} by submission, ${linkedByHeuristic} by heuristic)`);
  }

  return { scraped: claims.length, claims, autoLinked: totalLinked };
};

// =============================================
// STATS ROUTE
// =============================================

routes.GET["/api/stats"] = async () => {
  // Use fast SQL aggregation when SQLite is enabled
  if (getStorageBackend() === "sqlite") {
    return getStatsFast();
  }

  // Fallback to JSON file loading (slow)
  const [claims, documents, assignments, draftClaims] = await Promise.all([
    scrapedClaimsStorage.getAll(),
    documentsStorage.getAll(),
    assignmentsStorage.getAll(),
    draftClaimsStorage.getAll(),
  ]);

  return {
    claims: claims.length,
    documents: documents.length,
    assignments: {
      total: assignments.length,
      candidates: assignments.filter((a) => a.status === "candidate").length,
      confirmed: assignments.filter((a) => a.status === "confirmed").length,
      rejected: assignments.filter((a) => a.status === "rejected").length,
    },
    draftClaims: {
      total: draftClaims.length,
      pending: draftClaims.filter((d) => d.status === "pending").length,
      accepted: draftClaims.filter((d) => d.status === "accepted").length,
      rejected: draftClaims.filter((d) => d.status === "rejected").length,
    },
  };
};

// === FILE SERVING & UPLOAD ===

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".html": "text/html",
};

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

// Ensure uploads directory exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function sanitizeFilenameBase(name: string): string {
  const base = name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
  const trimmed = base.replace(/^-+/, "").replace(/-+$/, "");
  return trimmed || "upload";
}

function buildTimestampedFilename(originalName: string, mimeType: string): string {
  const timestamp = Date.now();
  const originalExt = path.extname(originalName);
  const ext =
    (originalExt && MIME_TYPES[originalExt.toLowerCase()] === mimeType
      ? originalExt
      : MIME_EXTENSIONS[mimeType]) || originalExt || ".bin";
  const baseName = path.basename(originalName, originalExt || ext);
  const safeBase = sanitizeFilenameBase(baseName);
  return `${timestamp}-${safeBase}${ext}`;
}

/**
 * Parse multipart/form-data from request.
 * Simple implementation for single file upload.
 */
async function parseMultipartFormData(
  req: http.IncomingMessage
): Promise<{ filename: string; mimeType: string; buffer: Buffer } | null> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] ?? "";
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      resolve(null);
      return;
    }

    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        const boundaryBuffer = Buffer.from(`--${boundary}`);

        // Find the first part (skip preamble)
        let start = buffer.indexOf(boundaryBuffer);
        if (start === -1) {
          resolve(null);
          return;
        }
        start += boundaryBuffer.length + 2; // Skip boundary + CRLF

        // Find headers end
        const headersEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), start);
        if (headersEnd === -1) {
          resolve(null);
          return;
        }

        const headersStr = buffer.slice(start, headersEnd).toString("utf-8");

        // Extract filename and content-type from headers
        const filenameMatch = headersStr.match(/filename="([^"]+)"/i);
        const contentTypeMatch = headersStr.match(/Content-Type:\s*([^\r\n]+)/i);

        if (!filenameMatch) {
          resolve(null);
          return;
        }

        const filename = filenameMatch[1];
        const mimeType = contentTypeMatch ? contentTypeMatch[1].trim() : "application/octet-stream";

        // Find content end (next boundary)
        const contentStart = headersEnd + 4; // Skip \r\n\r\n
        const endBoundary = buffer.indexOf(boundaryBuffer, contentStart);
        const contentEnd = endBoundary !== -1 ? endBoundary - 2 : buffer.length; // -2 for CRLF before boundary

        const fileBuffer = buffer.slice(contentStart, contentEnd);

        resolve({ filename, mimeType, buffer: fileBuffer });
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Generic file upload handler.
 * Creates a MedicalDocument record with the specified classification.
 */
async function handleFileUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  classification: "receipt" | "medical_bill"
): Promise<boolean> {
  const parsed = await parseMultipartFormData(req);
  if (!parsed) {
    json(res, { error: "Invalid file upload" }, 400);
    return true;
  }

  const { filename, mimeType, buffer } = parsed;

  // Validate file type
  const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
  if (!allowedTypes.includes(mimeType)) {
    json(res, { error: `Invalid file type: ${mimeType}. Allowed: images, PDF` }, 400);
    return true;
  }

  // Generate timestamped, safe filename
  const timestampedFilename = buildTimestampedFilename(filename, mimeType);
  let uniqueFilename = timestampedFilename;
  let filePath = path.join(UPLOADS_DIR, uniqueFilename);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(timestampedFilename);
    const base = path.basename(timestampedFilename, ext);
    uniqueFilename = `${base}-${Math.random().toString(36).slice(2, 6)}${ext}`;
    filePath = path.join(UPLOADS_DIR, uniqueFilename);
  }

  // Save file
  fs.writeFileSync(filePath, buffer);

  // Create MedicalDocument record
  const doc = await createMedicalDocument({
    sourceType: "manual_upload",
    filename: uniqueFilename,
    attachmentPath: filePath,
    mimeType,
    fileSize: buffer.length,
    classification,
    date: new Date(),
    detectedAmounts: [],
  });

  json(res, {
    id: doc.id,
    filename: doc.filename,
    mimeType: doc.mimeType,
    size: doc.fileSize,
  });

  return true;
}

/**
 * Handle proof file upload (receipt classification).
 */
async function handleProofUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  return handleFileUpload(req, res, "receipt");
}

/**
 * Handle attachment file upload (medical_bill classification).
 */
async function handleAttachmentUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  return handleFileUpload(req, res, "medical_bill");
}

/**
 * Serve attachment files directly.
 * This is a special handler that streams the file instead of returning JSON.
 */
async function serveAttachmentFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  documentId: string
): Promise<boolean> {
  const doc = await documentsStorage.get(documentId);
  if (!doc || !doc.attachmentPath) {
    return false;
  }

  const filePath = doc.attachmentPath;

  if (!fs.existsSync(filePath)) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";
  const filename = doc.filename ?? path.basename(filePath);

  const stat = fs.statSync(filePath);

  res.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": stat.size,
    "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400", // Cache for 1 day
  });

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  return true;
}

// === SERVER ===

function matchRoute(
  method: string,
  pathname: string
): { handler: RouteHandler; params: Record<string, string> } | null {
  const methodRoutes = routes[method as keyof typeof routes];
  if (!methodRoutes) return null;

  let parameterizedMatch: { handler: RouteHandler; params: Record<string, string> } | null = null;

  for (const [pattern, handler] of Object.entries(methodRoutes)) {
    const patternParts = pattern.split("/");
    const pathParts = pathname.split("/");

    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;
    let hasParams = false;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i]!.startsWith(":")) {
        params[patternParts[i]!.slice(1)] = pathParts[i]!;
        hasParams = true;
      } else if (patternParts[i] !== pathParts[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      if (!hasParams) return { handler: handler as RouteHandler, params };
      if (!parameterizedMatch) {
        parameterizedMatch = { handler: handler as RouteHandler, params };
      }
    }
  }

  return parameterizedMatch;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url ?? "/", true);
  const pathname = parsedUrl.pathname ?? "/";
  const method = req.method ?? "GET";

  console.log(`${method} ${pathname}`);

  try {
    // Special handling for file serving endpoint
    const fileMatch = pathname.match(/^\/api\/documents\/([^/]+)\/file$/);
    if (fileMatch && method === "GET") {
      const served = await serveAttachmentFile(req, res, fileMatch[1]!);
      if (!served) {
        json(res, { error: "File not found" }, 404);
      }
      return;
    }

    // Special handling for file uploads (multipart/form-data)
    if (pathname === "/api/proof-upload" && method === "POST") {
      await handleProofUpload(req, res);
      return;
    }
    if (pathname === "/api/attachment-upload" && method === "POST") {
      await handleAttachmentUpload(req, res);
      return;
    }

    const route = matchRoute(method, pathname);

    if (!route) {
      json(res, { error: "Not found" }, 404);
      return;
    }

    const body = method !== "GET" ? await parseBody(req) : undefined;
    const result = await route.handler(req, res, route.params, body);
    json(res, result);
  } catch (err) {
    const error = err as { status?: number; message?: string };
    console.error("Error:", error);
    json(
      res,
      { error: error.message ?? "Internal server error" },
      error.status ?? 500
    );
  }
}

/**
 * Validate that required Cigna credentials are available.
 * Fail fast at startup rather than at request time.
 */
function validateRequiredSecrets(): void {
  const cignaId = process.env.CIGNA_ID;
  const password = process.env.CIGNA_PASSWORD;

  const missing: string[] = [];
  if (!cignaId) missing.push("CIGNA_ID");
  if (!password) missing.push("CIGNA_PASSWORD");

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:", missing.join(", "));
    console.error("   Set these via environment or use scripts/start-dev.sh which loads from passveil");
    process.exit(1);
  }

  // TOTP is optional but warn if missing
  if (!process.env.CIGNA_TOTP_SECRET) {
    console.warn("⚠️  CIGNA_TOTP_SECRET not set - manual TOTP entry will be required for login");
  }
}

export function startServer(port = PORT) {
  validateRequiredSecrets();
  ensureStorageDirs();

  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    console.log(`API server running at http://localhost:${port}`);
    console.log("\nAvailable endpoints:");
    console.log("  GET  /api/stats");
    console.log("  GET  /api/claims");
    console.log("  GET  /api/documents");
    console.log("  PUT  /api/documents/:id/archive");
    console.log("  POST /api/documents/:id/promote");
    console.log("  GET  /api/archive-rules");
    console.log("  POST /api/archive-rules");
    console.log("  PUT  /api/archive-rules/:id");
    console.log("  DELETE /api/archive-rules/:id");
    console.log("  GET  /api/patients");
    console.log("  POST /api/patients");
    console.log("  GET  /api/illnesses");
    console.log("  POST /api/illnesses");
    console.log("  GET  /api/patients/:id/illnesses");
    console.log("  GET  /api/assignments");
    console.log("  POST /api/assignments/:id/confirm  - Requires illnessId");
    console.log("  GET  /api/assignments/:id/preview-accounts");
    console.log("  POST /api/process/documents  - Process email/calendar");
    console.log("  POST /api/process/match      - Run auto-matching");
    console.log("  POST /api/process/scrape     - Scrape claims from Cigna");
  });

  // Background full-history scans every 3 hours
  startDocumentProcessingSchedule();

  return server;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
