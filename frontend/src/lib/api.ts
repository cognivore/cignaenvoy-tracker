/**
 * API Client
 *
 * Fetches data from the backend API server.
 */

const API_BASE = "http://localhost:3001/api";

/**
 * Get the URL to view an attachment file directly.
 * Opens in browser for supported formats (PDF, images).
 */
export function getDocumentFileUrl(documentId: string): string {
  return `${API_BASE}/documents/${documentId}/file`;
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// === Types ===

export interface ScrapedLineItem {
  treatmentDescription: string;
  treatmentDate: string;
  claimAmount: number;
  claimCurrency: string;
  amountPaid?: number;
  paymentCurrency?: string;
  status: "processed" | "pending" | "rejected";
}

export interface ScrapedClaim {
  id: string;
  cignaClaimNumber: string;
  submissionNumber: string;
  memberName: string;
  treatmentDate: string;
  claimAmount: number;
  claimCurrency: string;
  amountPaid?: number;
  paymentCurrency?: string;
  status: "processed" | "pending" | "rejected";
  submissionDate: string;
  lineItems: ScrapedLineItem[];
  scrapedAt: string;
}

export interface DetectedAmount {
  value: number;
  currency: string;
  rawText: string;
  context?: string;
  confidence: number;
}

export interface MedicalDocument {
  id: string;
  sourceType: "email" | "attachment" | "calendar";
  emailId?: string;
  account?: string;
  attachmentPath?: string;
  filename?: string;
  mimeType?: string;
  fileSize?: number;
  ocrText?: string;
  ocrCharCount?: number;
  detectedAmounts: DetectedAmount[];
  classification: string;
  fromAddress?: string;
  toAddress?: string;
  subject?: string;
  bodySnippet?: string;
  date?: string;
  medicalKeywords: string[];
  processedAt: string;
}

export interface DocumentClaimAssignment {
  id: string;
  documentId: string;
  claimId: string;
  matchScore: number;
  matchReasonType: string;
  matchReason: string;
  status: "candidate" | "confirmed" | "rejected";
  amountMatchDetails?: {
    documentAmount: number;
    documentCurrency: string;
    claimAmount: number;
    claimCurrency: string;
    difference: number;
    differencePercent: number;
  };
  dateMatchDetails?: {
    documentDate: string;
    claimDate: string;
    daysDifference: number;
  };
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  reviewNotes?: string;
}

export interface Stats {
  claims: number;
  documents: number;
  assignments: {
    total: number;
    candidates: number;
    confirmed: number;
    rejected: number;
  };
}

// === API Functions ===

export const api = {
  // Stats
  getStats: () => fetchJson<Stats>("/stats"),

  // Claims
  getClaims: () => fetchJson<ScrapedClaim[]>("/claims"),
  getClaim: (id: string) => fetchJson<ScrapedClaim>(`/claims/${id}`),

  // Documents
  getDocuments: () => fetchJson<MedicalDocument[]>("/documents"),
  getDocument: (id: string) => fetchJson<MedicalDocument>(`/documents/${id}`),
  getMedicalBills: () => fetchJson<MedicalDocument[]>("/documents/medical-bills"),

  // Assignments
  getAssignments: () => fetchJson<DocumentClaimAssignment[]>("/assignments"),
  getCandidates: () => fetchJson<DocumentClaimAssignment[]>("/assignments/candidates"),
  getConfirmed: () => fetchJson<DocumentClaimAssignment[]>("/assignments/confirmed"),

  confirmAssignment: (id: string, reviewNotes?: string) =>
    fetchJson<DocumentClaimAssignment>(`/assignments/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ reviewNotes }),
    }),

  rejectAssignment: (id: string, reviewNotes?: string) =>
    fetchJson<DocumentClaimAssignment>(`/assignments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reviewNotes }),
    }),

  // Processing
  processDocuments: () =>
    fetchJson<{ processed: number; documents: MedicalDocument[] }>(
      "/process/documents",
      { method: "POST" }
    ),

  runMatching: () =>
    fetchJson<{ created: number; assignments: DocumentClaimAssignment[] }>(
      "/process/match",
      { method: "POST" }
    ),

  scrapeClaims: (credentials: {
    cignaId: string;
    password: string;
    totpSecret?: string;
  }) =>
    fetchJson<{ scraped: number; claims: ScrapedClaim[] }>("/process/scrape", {
      method: "POST",
      body: JSON.stringify(credentials),
    }),
};
