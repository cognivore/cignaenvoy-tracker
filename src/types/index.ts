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
  CreateIllnessInput,
  UpdateIllnessInput,
} from "./illness.js";

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
