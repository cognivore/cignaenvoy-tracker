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
  archivedAt?: string;
}

export interface DetectedAmount {
  value: number;
  currency: string;
  rawText: string;
  context?: string;
  confidence: number;
}

export interface PaymentOverride {
  amount: number;
  currency: string;
  note?: string;
  updatedAt: string;
}

export interface CalendarAttendee {
  email: string;
  name?: string;
  response?: string;
  organizer?: boolean;
}

export interface CalendarOrganizer {
  email?: string;
  displayName?: string;
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
  // Calendar-specific fields
  calendarEventId?: string;
  calendarId?: string;
  calendarSummary?: string;
  calendarDescription?: string;
  calendarLocation?: string;
  calendarStart?: string;
  calendarEnd?: string;
  calendarAllDay?: boolean;
  calendarAttendees?: CalendarAttendee[];
  calendarOrganizer?: CalendarOrganizer;
  calendarConferenceUrl?: string;
  // Override fields
  paymentOverride?: PaymentOverride;
  archivedAt?: string;
  archivedByRuleId?: string;
  archivedReason?: string;
  processedAt: string;
}

export type DraftClaimStatus = "pending" | "accepted" | "rejected";
export type DraftClaimDateSource = "calendar" | "manual" | "document";
export type DraftClaimRange = "forever" | "last_month" | "last_week";

export type DraftClaimPaymentSource = "detected" | "override";

export interface DraftClaimPayment {
  amount: number;
  currency: string;
  rawText?: string;
  context?: string;
  confidence?: number;
  source?: DraftClaimPaymentSource;
  overrideNote?: string;
  overrideUpdatedAt?: string;
}

export interface DraftClaim {
  id: string;
  status: DraftClaimStatus;
  primaryDocumentId: string;
  documentIds: string[];
  payment: DraftClaimPayment;
  paymentProofDocumentIds?: string[];
  paymentProofText?: string;
  illnessId?: string;
  doctorNotes?: string;
  treatmentDate?: string;
  treatmentDateSource?: DraftClaimDateSource;
  calendarDocumentIds?: string[];
  generatedAt: string;
  updatedAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
  archivedAt?: string;
}

export interface DocumentClaimAssignment {
  id: string;
  documentId: string;
  claimId: string;
  illnessId?: string;
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

export interface Patient {
  id: string;
  cignaId: string;
  name: string;
  relationship: "Employee" | "Member" | "Beneficiary";
  dateOfBirth: string;
  citizenship?: string;
  workLocation?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface RelevantAccount {
  email: string;
  name?: string;
  role?: "provider" | "pharmacy" | "lab" | "insurance" | "other";
  addedAt: string;
  sourceDocumentId?: string;
}

export interface Illness {
  id: string;
  patientId: string;
  name: string;
  icdCode?: string;
  type: "acute" | "chronic";
  onsetDate?: string;
  resolvedDate?: string;
  notes?: string;
  relevantAccounts: RelevantAccount[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ArchiveRule {
  id: string;
  name: string;
  enabled: boolean;
  fromContains?: string;
  subjectContains?: string;
  attachmentNameContains?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateArchiveRuleInput {
  name: string;
  enabled: boolean;
  fromContains?: string;
  subjectContains?: string;
  attachmentNameContains?: string;
  applyToExisting?: boolean;
}

export type UpdateArchiveRuleInput = Partial<
  Omit<CreateArchiveRuleInput, "applyToExisting">
>;

export interface CreatePatientInput {
  cignaId: string;
  name: string;
  relationship: "Employee" | "Member" | "Beneficiary";
  dateOfBirth: string;
  citizenship?: string;
  workLocation?: string;
  email?: string;
}

export interface CreateIllnessInput {
  patientId: string;
  name: string;
  icdCode?: string;
  type: "acute" | "chronic";
  onsetDate?: string;
  notes?: string;
}

export interface PreviewAccountsResponse {
  accounts: RelevantAccount[];
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
  draftClaims: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
  };
}

export interface PromoteDraftClaimResponse {
  draft: DraftClaim;
  created: boolean;
  expanded: boolean;
}

// === API Functions ===

export const api = {
  // Stats
  getStats: () => fetchJson<Stats>("/stats"),

  // Claims
  getClaims: () => fetchJson<ScrapedClaim[]>("/claims"),
  getClaim: (id: string) => fetchJson<ScrapedClaim>(`/claims/${id}`),
  getArchivedClaims: () => fetchJson<ScrapedClaim[]>("/claims/archived"),
  getActiveClaims: () => fetchJson<ScrapedClaim[]>("/claims/active"),
  setClaimArchived: (id: string, archived: boolean) =>
    fetchJson<ScrapedClaim>(`/claims/${id}/archive`, {
      method: "PUT",
      body: JSON.stringify({ archived }),
    }),

  // Documents
  getDocuments: () => fetchJson<MedicalDocument[]>("/documents"),
  getDocument: (id: string) => fetchJson<MedicalDocument>(`/documents/${id}`),
  getMedicalBills: () => fetchJson<MedicalDocument[]>("/documents/medical-bills"),
  promoteDocumentToDraftClaim: (id: string) =>
    fetchJson<PromoteDraftClaimResponse>(`/documents/${id}/promote`, {
      method: "POST",
    }),
  setDocumentArchived: (
    id: string,
    input: { archived: boolean; reason?: string; ruleId?: string }
  ) =>
    fetchJson<MedicalDocument>(`/documents/${id}/archive`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  setPaymentOverride: (
    id: string,
    override: { amount: number; currency: string; note?: string } | null
  ) =>
    fetchJson<MedicalDocument>(`/documents/${id}/payment-override`, {
      method: "PUT",
      body: JSON.stringify(override ? override : { clear: true }),
    }),

  // Archive rules
  getArchiveRules: () => fetchJson<ArchiveRule[]>("/archive-rules"),
  createArchiveRule: (input: CreateArchiveRuleInput) =>
    fetchJson<ArchiveRule>("/archive-rules", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateArchiveRule: (id: string, updates: UpdateArchiveRuleInput) =>
    fetchJson<ArchiveRule>(`/archive-rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  deleteArchiveRule: (id: string) =>
    fetchJson<{ success: boolean }>(`/archive-rules/${id}`, {
      method: "DELETE",
    }),

  // Patients
  getPatients: () => fetchJson<Patient[]>("/patients"),
  getPatient: (id: string) => fetchJson<Patient>(`/patients/${id}`),
  getArchivedPatients: () => fetchJson<Patient[]>("/patients/archived"),
  getActivePatients: () => fetchJson<Patient[]>("/patients/active"),
  createPatient: (input: CreatePatientInput) =>
    fetchJson<Patient>("/patients", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updatePatient: (id: string, updates: Partial<CreatePatientInput>) =>
    fetchJson<Patient>(`/patients/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  setPatientArchived: (id: string, archived: boolean) =>
    fetchJson<Patient>(`/patients/${id}/archive`, {
      method: "PUT",
      body: JSON.stringify({ archived }),
    }),

  // Illnesses
  getIllnesses: () => fetchJson<Illness[]>("/illnesses"),
  getIllness: (id: string) => fetchJson<Illness>(`/illnesses/${id}`),
  getArchivedIllnesses: () => fetchJson<Illness[]>("/illnesses/archived"),
  getActiveIllnesses: () => fetchJson<Illness[]>("/illnesses/active"),
  getPatientIllnesses: (patientId: string) =>
    fetchJson<Illness[]>(`/patients/${patientId}/illnesses`),
  getPatientActiveIllnesses: (patientId: string) =>
    fetchJson<Illness[]>(`/patients/${patientId}/illnesses/active`),
  createIllness: (input: CreateIllnessInput) =>
    fetchJson<Illness>("/illnesses", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateIllness: (id: string, updates: Partial<CreateIllnessInput>) =>
    fetchJson<Illness>(`/illnesses/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
  setIllnessArchived: (id: string, archived: boolean) =>
    fetchJson<Illness>(`/illnesses/${id}/archive`, {
      method: "PUT",
      body: JSON.stringify({ archived }),
    }),

  // Assignments
  getAssignments: () => fetchJson<DocumentClaimAssignment[]>("/assignments"),
  getCandidates: () => fetchJson<DocumentClaimAssignment[]>("/assignments/candidates"),
  getConfirmed: () => fetchJson<DocumentClaimAssignment[]>("/assignments/confirmed"),

  confirmAssignment: (id: string, illnessId: string, reviewNotes?: string) =>
    fetchJson<DocumentClaimAssignment>(`/assignments/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ illnessId, reviewNotes }),
    }),

  rejectAssignment: (id: string, reviewNotes?: string) =>
    fetchJson<DocumentClaimAssignment>(`/assignments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reviewNotes }),
    }),

  previewAccounts: (assignmentId: string) =>
    fetchJson<PreviewAccountsResponse>(`/assignments/${assignmentId}/preview-accounts`),

  // Draft Claims
  getDraftClaims: () => fetchJson<DraftClaim[]>("/draft-claims"),
  getArchivedDraftClaims: () => fetchJson<DraftClaim[]>("/draft-claims/archived"),
  getActiveDraftClaims: () => fetchJson<DraftClaim[]>("/draft-claims/active"),
  setDraftClaimArchived: (id: string, archived: boolean) =>
    fetchJson<DraftClaim>(`/draft-claims/${id}/archive`, {
      method: "PUT",
      body: JSON.stringify({ archived }),
    }),
  generateDraftClaims: (range: DraftClaimRange) =>
    fetchJson<{ created: number; drafts: DraftClaim[] }>("/draft-claims/generate", {
      method: "POST",
      body: JSON.stringify({ range }),
    }),
  acceptDraftClaim: (
    id: string,
    input: {
      illnessId: string;
      doctorNotes: string;
      calendarDocumentIds?: string[];
      treatmentDate?: string;
      paymentProofDocumentIds?: string[];
      paymentProofText?: string;
    }
  ) =>
    fetchJson<DraftClaim>(`/draft-claims/${id}/accept`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  rejectDraftClaim: (id: string) =>
    fetchJson<DraftClaim>(`/draft-claims/${id}/reject`, {
      method: "POST",
    }),
  markDraftClaimPending: (id: string) =>
    fetchJson<DraftClaim>(`/draft-claims/${id}/pending`, {
      method: "POST",
    }),
  runDraftMatching: () =>
    fetchJson<{ created: number; assignments: DocumentClaimAssignment[] }>(
      "/draft-claims/run-matching",
      { method: "POST" }
    ),

  // Processing
  processDocuments: () =>
    fetchJson<{ processed: number; documents: MedicalDocument[] }>(
      "/process/documents",
      { method: "POST" }
    ),

  processCalendar: () =>
    fetchJson<{ processed: number; documents: MedicalDocument[] }>(
      "/process/calendar",
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
