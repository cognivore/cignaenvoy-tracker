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
import { claimsStorage } from "../storage/claims.js";
import { documentsStorage, getMedicalBills, setPaymentOverride } from "../storage/documents.js";
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
} from "../storage/draft-claims.js";
import {
  patientsStorage,
  createPatient,
  updatePatient,
  findPatientByCignaId,
} from "../storage/patients.js";
import {
  illnessesStorage,
  createIllness,
  updateIllness,
  getIllnessesForPatient,
  getActiveIllnesses,
  addRelevantAccounts,
} from "../storage/illnesses.js";
import { ensureStorageDirs } from "../storage/index.js";
import { DocumentProcessor } from "../services/document-processor.js";
import { generateDraftClaims } from "../services/draft-claim-generator.js";
import { Matcher } from "../services/matcher.js";
import { CignaScraper } from "../services/cigna-scraper.js";
import { extractAndPrepareAccounts } from "../services/account-extractor.js";
import type { CreatePatientInput, UpdatePatientInput } from "../types/patient.js";
import type { CreateIllnessInput, UpdateIllnessInput } from "../types/illness.js";
import type { DraftClaimRange, DraftClaimDateSource } from "../types/draft-claim.js";
import type { MedicalDocument } from "../types/medical-document.js";

const PORT = 3001;

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

routes.GET["/api/claims"] = async () => claimsStorage.getAll();

routes.GET["/api/claims/:id"] = async (_req, _res, params) => {
  const claim = await claimsStorage.get(params.id!);
  requireEntity(claim, "Claim");
  return claim;
};

// =============================================
// DOCUMENTS ROUTES
// =============================================

routes.GET["/api/documents"] = async () => documentsStorage.getAll();

routes.GET["/api/documents/:id"] = async (_req, _res, params) => {
  const doc = await documentsStorage.get(params.id!);
  requireEntity(doc, "Document");
  return doc;
};

routes.GET["/api/documents/medical-bills"] = async () => getMedicalBills();

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
    return updated;
  }

  // Validate override fields
  if (amount === undefined || !currency) {
    httpError(400, "amount and currency are required to set a payment override");
  }

  if (typeof amount !== "number" || amount < 0) {
    httpError(400, "amount must be a non-negative number");
  }

  const updated = await setPaymentOverride(params.id!, { amount, currency, note });
  requireEntity(updated, "Document");
  return updated;
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
  const { illnessId, doctorNotes, calendarDocumentIds, treatmentDate } = body as {
    illnessId?: string;
    doctorNotes?: string;
    calendarDocumentIds?: string[];
    treatmentDate?: string;
  };

  requireFields({ illnessId }, ["illnessId"], "illnessId is required to accept a draft claim");

  const trimmedNotes = doctorNotes?.trim();
  if (!trimmedNotes) httpError(400, "doctorNotes is required to accept a draft claim");

  const draft = await draftClaimsStorage.get(params.id!);
  requireEntity(draft, "Draft claim");

  const illness = await illnessesStorage.get(illnessId!);
  requireEntity(illness, "Illness");

  const calendarIds = Array.isArray(calendarDocumentIds) ? calendarDocumentIds.filter(Boolean) : [];

  // Determine treatment date
  const { finalDate, dateSource } = await resolveTreatmentDate(treatmentDate, calendarIds);

  const documentIds = Array.from(new Set([...draft.documentIds, ...calendarIds]));

  const updated = await updateDraftClaim(params.id!, {
    status: "accepted",
    illnessId: illnessId!,
    doctorNotes: trimmedNotes,
    treatmentDate: finalDate,
    treatmentDateSource: dateSource,
    ...(calendarIds.length > 0 && { calendarDocumentIds: calendarIds }),
    documentIds,
    acceptedAt: new Date(),
  });

  requireEntity(updated, "Draft claim");
  return updated;
};

routes.POST["/api/draft-claims/:id/reject"] = async (_req, _res, params) => {
  const updated = await updateDraftClaim(params.id!, {
    status: "rejected",
    rejectedAt: new Date(),
  });
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

// =============================================
// PROCESSING ROUTES
// =============================================

routes.POST["/api/process/documents"] = async () => {
  const processor = new DocumentProcessor();
  const docs = await processor.run();
  return { processed: docs.length, documents: docs };
};

routes.POST["/api/process/match"] = async () => {
  const matcher = new Matcher();
  const assignments = await matcher.matchAllDocuments();
  return { created: assignments.length, assignments };
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
  return { scraped: claims.length, claims };
};

// =============================================
// STATS ROUTE
// =============================================

routes.GET["/api/stats"] = async () => {
  const [claims, documents, assignments, draftClaims] = await Promise.all([
    claimsStorage.getAll(),
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

// === FILE SERVING ===

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

  for (const [pattern, handler] of Object.entries(methodRoutes)) {
    const patternParts = pattern.split("/");
    const pathParts = pathname.split("/");

    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i]!.startsWith(":")) {
        params[patternParts[i]!.slice(1)] = pathParts[i]!;
      } else if (patternParts[i] !== pathParts[i]) {
        match = false;
        break;
      }
    }

    if (match) return { handler: handler as RouteHandler, params };
  }

  return null;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

export function startServer(port = PORT) {
  ensureStorageDirs();

  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    console.log(`API server running at http://localhost:${port}`);
    console.log("\nAvailable endpoints:");
    console.log("  GET  /api/stats");
    console.log("  GET  /api/claims");
    console.log("  GET  /api/documents");
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

  return server;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
