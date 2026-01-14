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
import { ensureStorageDirs } from "../storage/index.js";
import { DocumentProcessor } from "../services/document-processor.js";
import { Matcher } from "../services/matcher.js";
import { CignaScraper } from "../services/cigna-scraper.js";

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
  const { reviewNotes } = body as { reviewNotes?: string };
  const assignment = await confirmAssignment(params.id!, undefined, reviewNotes);
  if (!assignment) throw { status: 404, message: "Assignment not found" };
  return assignment;
};

routes.POST["/api/assignments/:id/reject"] = async (_req, _res, params, body) => {
  const { reviewNotes } = body as { reviewNotes?: string };
  const assignment = await rejectAssignment(params.id!, reviewNotes);
  if (!assignment) throw { status: 404, message: "Assignment not found" };
  return assignment;
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

  return {
    claims: claims.length,
    documents: documents.length,
    assignments: {
      total: assignments.length,
      candidates: assignments.filter((a) => a.status === "candidate").length,
      confirmed: assignments.filter((a) => a.status === "confirmed").length,
      rejected: assignments.filter((a) => a.status === "rejected").length,
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
    console.log("  GET  /api/assignments");
    console.log("  POST /api/process/documents  - Process email attachments");
    console.log("  POST /api/process/match      - Run auto-matching");
    console.log("  POST /api/process/scrape     - Scrape claims from Cigna");
  });

  return server;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
