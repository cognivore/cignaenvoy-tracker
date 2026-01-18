/**
 * Cigna Envoy Tracker Type Definitions
 *
 * Local-first database schema for managing insurance claims workflow.
 * Types designed from Cigna Envoy portal UI analysis.
 */

// Patient identity types
export type {
  Patient,
  PatientRelationship,
  CreatePatientInput,
  UpdatePatientInput,
} from "./patient.js";

// Illness/condition types
export type {
  Illness,
  IllnessType,
  AccountRole,
  RelevantAccount,
  CreateIllnessInput,
  UpdateIllnessInput,
} from "./illness.js";
export { ACCOUNT_ROLES } from "./illness.js";

// Treatment types
export type {
  Treatment,
  TreatmentType,
  FacilityType,
  CreateTreatmentInput,
  UpdateTreatmentInput,
} from "./treatment.js";
export { TREATMENT_TYPES } from "./treatment.js";

// Evidence types
export type {
  Evidence,
  EvidenceType,
  CreateEvidenceInput,
  UpdateEvidenceInput,
} from "./evidence.js";
export { EVIDENCE_TYPES } from "./evidence.js";

// Claim types
export type {
  Claim,
  ClaimType,
  ClaimStatus,
  Symptom,
  ClaimDocument,
  AllowedMimeType,
  CreateClaimInput,
  UpdateClaimInput,
  CreateClaimDocumentInput,
} from "./claim.js";
export {
  CLAIM_TYPES,
  CLAIM_STATUSES,
  ALLOWED_FILE_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_ATTACHMENTS_BYTES,
} from "./claim.js";

// Reference data
export type { Country, Currency, Network } from "./reference.js";
export { COUNTRIES, CURRENCIES, CURRENCY_CODES, NETWORKS } from "./reference.js";

// Scraped claim types (from Cigna Envoy portal)
export type {
  ScrapedClaim,
  ScrapedLineItem,
  ScrapedClaimStatus,
  CreateScrapedClaimInput,
} from "./scraped-claim.js";
export { SCRAPED_CLAIM_STATUSES } from "./scraped-claim.js";

// Medical document types (from email/attachment/calendar)
export type {
  MedicalDocument,
  DocumentSourceType,
  DocumentClassification,
  DetectedAmount,
  PaymentOverride,
  CalendarAttendee,
  CalendarOrganizer,
  CreateMedicalDocumentInput,
} from "./medical-document.js";
export {
  DOCUMENT_SOURCE_TYPES,
  DOCUMENT_CLASSIFICATIONS,
  MEDICAL_KEYWORDS,
} from "./medical-document.js";

// Attachment processing types
export type {
  AttachmentProcessingRecord,
  AttachmentProcessingStatus,
  CreateAttachmentProcessingRecordInput,
  UpdateAttachmentProcessingRecordInput,
} from "./attachment-processing.js";

// Draft claim types
export type {
  DraftClaim,
  DraftClaimStatus,
  DraftClaimRange,
  DraftClaimDateSource,
  DraftClaimPaymentSource,
  DraftClaimPayment,
  CreateDraftClaimInput,
  UpdateDraftClaimInput,
} from "./draft-claim.js";
export {
  DRAFT_CLAIM_STATUSES,
  DRAFT_CLAIM_RANGES,
  DRAFT_CLAIM_DATE_SOURCES,
  DRAFT_CLAIM_PAYMENT_SOURCES,
} from "./draft-claim.js";

// Document-claim assignment types
export type {
  DocumentClaimAssignment,
  AssignmentStatus,
  MatchReasonType,
  CreateAssignmentInput,
  UpdateAssignmentInput,
} from "./assignment.js";
export {
  ASSIGNMENT_STATUSES,
  MATCH_REASON_TYPES,
  MATCH_THRESHOLDS,
} from "./assignment.js";
