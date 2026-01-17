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
import { documentsStorage, getMedicalBills } from "../storage/documents.js";
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

// Helper to send JSON response
function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

// Helper to parse JSON body
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

/**
 * Extract the earliest treatment date from calendar documents.
 */
function getCalendarTreatmentDate(
  calendarDocs: MedicalDocument[]
): Date | null {
  const dates = calendarDocs
    .map((doc) => doc.calendarStart ?? doc.date)
    .filter((date): date is Date => !!date)
    .map((date) => new Date(date));

  if (dates.length === 0) return null;

  const earliest = Math.min(...dates.map((date) => date.getTime()));
  return new Date(earliest);
}

// === CLAIMS ROUTES ===

routes.GET["/api/claims"] = async () => {
  return claimsStorage.getAll();
};

routes.GET["/api/claims/:id"] = async (_req, _res, params) => {
  const claim = await claimsStorage.get(params.id!);
  if (!claim) throw { status: 404, message: "Claim not found" };
  return claim;
};

// === DOCUMENTS ROUTES ===

routes.GET["/api/documents"] = async () => {
  return documentsStorage.getAll();
};

routes.GET["/api/documents/:id"] = async (_req, _res, params) => {
  const doc = await documentsStorage.get(params.id!);
  if (!doc) throw { status: 404, message: "Document not found" };
  return doc;
};

routes.GET["/api/documents/medical-bills"] = async () => {
  return getMedicalBills();
};

// === PATIENTS ROUTES ===

routes.GET["/api/patients"] = async () => {
  return patientsStorage.getAll();
};

routes.GET["/api/patients/:id"] = async (_req, _res, params) => {
  const patient = await patientsStorage.get(params.id!);
  if (!patient) throw { status: 404, message: "Patient not found" };
  return patient;
};

routes.POST["/api/patients"] = async (_req, _res, _params, body) => {
  const input = body as CreatePatientInput;
  if (!input.cignaId || !input.name) {
    throw { status: 400, message: "cignaId and name are required" };
  }
  return createPatient(input);
};

routes.PUT["/api/patients/:id"] = async (_req, _res, params, body) => {
  const updates = body as UpdatePatientInput;
  const patient = await updatePatient(params.id!, updates);
  if (!patient) throw { status: 404, message: "Patient not found" };
  return patient;
};

routes.GET["/api/patients/by-cigna-id/:cignaId"] = async (_req, _res, params) => {
  const patient = await findPatientByCignaId(params.cignaId!);
  if (!patient) throw { status: 404, message: "Patient not found" };
  return patient;
};

// === ILLNESSES ROUTES ===

routes.GET["/api/illnesses"] = async () => {
  return illnessesStorage.getAll();
};

routes.GET["/api/illnesses/:id"] = async (_req, _res, params) => {
  const illness = await illnessesStorage.get(params.id!);
  if (!illness) throw { status: 404, message: "Illness not found" };
  return illness;
};

routes.POST["/api/illnesses"] = async (_req, _res, _params, body) => {
  const input = body as CreateIllnessInput;
  if (!input.patientId || !input.name || !input.type) {
    throw { status: 400, message: "patientId, name, and type are required" };
  }
  return createIllness(input);
};

routes.PUT["/api/illnesses/:id"] = async (_req, _res, params, body) => {
  const updates = body as UpdateIllnessInput;
  const illness = await updateIllness(params.id!, updates);
  if (!illness) throw { status: 404, message: "Illness not found" };
  return illness;
};

routes.GET["/api/patients/:patientId/illnesses"] = async (_req, _res, params) => {
  return getIllnessesForPatient(params.patientId!);
};

routes.GET["/api/patients/:patientId/illnesses/active"] = async (_req, _res, params) => {
  return getActiveIllnesses(params.patientId!);
};

// === ASSIGNMENTS ROUTES ===

routes.GET["/api/assignments"] = async () => {
  return assignmentsStorage.getAll();
};

routes.GET["/api/assignments/candidates"] = async () => {
  return getCandidateAssignments();
};

routes.GET["/api/assignments/confirmed"] = async () => {
  return getConfirmedAssignments();
};

routes.POST["/api/assignments/:id/confirm"] = async (_req, _res, params, body) => {
  const { illnessId, reviewNotes } = body as { illnessId?: string; reviewNotes?: string };

  // Illness ID is required for confirmation
  if (!illnessId) {
    throw { status: 400, message: "illnessId is required to confirm an assignment" };
  }

  // Verify illness exists
  const illness = await illnessesStorage.get(illnessId);
  if (!illness) {
    throw { status: 404, message: "Illness not found" };
  }

  // Get the assignment to extract accounts from its document
  const existingAssignment = await assignmentsStorage.get(params.id!);
  if (!existingAssignment) {
    throw { status: 404, message: "Assignment not found" };
  }

  // Get the document to extract accounts
  const document = await documentsStorage.get(existingAssignment.documentId);

  // Extract and add relevant accounts to the illness
  if (document) {
    const accounts = extractAndPrepareAccounts(document);
    if (accounts.length > 0) {
      await addRelevantAccounts(illnessId, accounts);
    }
  }

  // Confirm the assignment
  const assignment = await confirmAssignment(params.id!, illnessId, undefined, reviewNotes);
  if (!assignment) throw { status: 404, message: "Assignment not found" };
  return assignment;
};

routes.POST["/api/assignments/:id/reject"] = async (_req, _res, params, body) => {
  const { reviewNotes } = body as { reviewNotes?: string };
  const assignment = await rejectAssignment(params.id!, reviewNotes);
  if (!assignment) throw { status: 404, message: "Assignment not found" };
  return assignment;
};

/**
 * Preview which accounts would be extracted from an assignment's document.
 */
routes.GET["/api/assignments/:id/preview-accounts"] = async (_req, _res, params) => {
  const assignment = await assignmentsStorage.get(params.id!);
  if (!assignment) throw { status: 404, message: "Assignment not found" };

  const document = await documentsStorage.get(assignment.documentId);
  if (!document) {
    return { accounts: [] };
  }

  const accounts = extractAndPrepareAccounts(document);
  return { accounts };
};

// === DRAFT CLAIMS ROUTES ===

routes.GET["/api/draft-claims"] = async () => {
  return draftClaimsStorage.getAll();
};

routes.POST["/api/draft-claims/generate"] = async (_req, _res, _params, body) => {
  const { range } = body as { range?: DraftClaimRange };
  const selectedRange =
    range === "forever" || range === "last_month" || range === "last_week"
      ? range
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
  } = body as {
    illnessId?: string;
    doctorNotes?: string;
    calendarDocumentIds?: string[];
    treatmentDate?: string;
  };

  if (!illnessId) {
    throw { status: 400, message: "illnessId is required to accept a draft claim" };
  }

  const trimmedNotes = doctorNotes?.trim();
  if (!trimmedNotes) {
    throw { status: 400, message: "doctorNotes is required to accept a draft claim" };
  }

  const draft = await draftClaimsStorage.get(params.id!);
  if (!draft) throw { status: 404, message: "Draft claim not found" };

  const illness = await illnessesStorage.get(illnessId);
  if (!illness) throw { status: 404, message: "Illness not found" };

  const calendarIds = Array.isArray(calendarDocumentIds)
    ? calendarDocumentIds.filter(Boolean)
    : [];

  let finalTreatmentDate: Date | null = null;
  let dateSource: DraftClaimDateSource | undefined;

  if (treatmentDate) {
    const parsed = new Date(treatmentDate);
    if (Number.isNaN(parsed.valueOf())) {
      throw { status: 400, message: "treatmentDate must be a valid date" };
    }
    finalTreatmentDate = parsed;
    dateSource = "manual";
  }

  if (!finalTreatmentDate && calendarIds.length > 0) {
    const calendarDocs = await Promise.all(
      calendarIds.map((id) => documentsStorage.get(id))
    );

    if (calendarDocs.some((doc) => !doc)) {
      throw { status: 404, message: "Calendar document not found" };
    }

    const validDocs = calendarDocs.filter(
      (doc): doc is MedicalDocument => !!doc
    );

    const nonCalendar = validDocs.filter((doc) => doc.sourceType !== "calendar");
    if (nonCalendar.length > 0) {
      throw { status: 400, message: "calendarDocumentIds must be calendar documents" };
    }

    const derivedDate = getCalendarTreatmentDate(validDocs);
    if (!derivedDate) {
      throw { status: 400, message: "No usable dates found in calendar documents" };
    }

    finalTreatmentDate = derivedDate;
    dateSource = "calendar";
  }

  if (!finalTreatmentDate) {
    throw {
      status: 400,
      message: "treatmentDate or calendarDocumentIds is required to accept a draft claim",
    };
  }

  const documentIds = Array.from(
    new Set([...draft.documentIds, ...calendarIds])
  );

  const updated = await updateDraftClaim(params.id!, {
    status: "accepted",
    illnessId,
    doctorNotes: trimmedNotes,
    treatmentDate: finalTreatmentDate,
    treatmentDateSource: dateSource,
    ...(calendarIds.length > 0 && { calendarDocumentIds: calendarIds }),
    documentIds,
    acceptedAt: new Date(),
  });

  if (!updated) throw { status: 404, message: "Draft claim not found" };
  return updated;
};

routes.POST["/api/draft-claims/:id/reject"] = async (_req, _res, params) => {
  const updated = await updateDraftClaim(params.id!, {
    status: "rejected",
    rejectedAt: new Date(),
  });
  if (!updated) throw { status: 404, message: "Draft claim not found" };
  return updated;
};

routes.POST["/api/draft-claims/run-matching"] = async () => {
  const drafts = await draftClaimsStorage.find(
    (draft) => draft.status === "accepted"
  );
  const documentIds = Array.from(
    new Set(drafts.flatMap((draft) => draft.documentIds))
  );

  if (documentIds.length === 0) {
    return { created: 0, assignments: [] };
  }

  const matcher = new Matcher();
  const assignments = await matcher.matchDocumentsByIds(documentIds);
  return { created: assignments.length, assignments };
};

// === PROCESSING ROUTES ===

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
  // Process only calendar events (not emails)
  // Use DEFAULT_CALENDAR_QUERIES which includes "therapy" and other medical terms
  const processor = new DocumentProcessor({
    processCalendar: true,
  });
  const docs = await processor.processCalendarEventsFromSearch();
  return { processed: docs.length, documents: docs };
};

routes.POST["/api/process/scrape"] = async (_req, _res, _params, body) => {
  const bodyData = body as {
    cignaId?: string;
    password?: string;
    totpSecret?: string;
    headless?: boolean;
  };

  // Use body credentials or fall back to environment variables
  const cignaId = bodyData.cignaId ?? process.env.CIGNA_ID;
  const password = bodyData.password ?? process.env.CIGNA_PASSWORD;
  const totpSecret = bodyData.totpSecret ?? process.env.CIGNA_TOTP_SECRET;
  // Default to headless for automated runs, can be overridden via body
  const headless = bodyData.headless ?? true;

  if (!cignaId || !password) {
    throw { status: 400, message: "cignaId and password required (via body or CIGNA_ID/CIGNA_PASSWORD env vars)" };
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

// === STATS ROUTE ===

routes.GET["/api/stats"] = async () => {
  const claims = await claimsStorage.getAll();
  const documents = await documentsStorage.getAll();
  const assignments = await assignmentsStorage.getAll();
  const draftClaims = await draftClaimsStorage.getAll();

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
