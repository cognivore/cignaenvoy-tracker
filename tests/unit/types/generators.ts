/**
 * fast-check Arbitraries for domain types.
 *
 * These generators produce valid instances of our domain types,
 * respecting invariants like temporal ordering and referential integrity.
 */

import fc from "fast-check";
import type {
  Patient,
  PatientRelationship,
  Illness,
  IllnessType,
  Treatment,
  TreatmentType,
  FacilityType,
  Evidence,
  EvidenceType,
  Claim,
  ClaimType,
  ClaimStatus,
  Symptom,
  ClaimDocument,
  AllowedMimeType,
} from "../../../src/types/index.js";
import {
  TREATMENT_TYPES,
  EVIDENCE_TYPES,
  CLAIM_TYPES,
  CLAIM_STATUSES,
  COUNTRIES,
  CURRENCIES,
  ALLOWED_FILE_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
} from "../../../src/types/index.js";

// =============================================================================
// Helper: Remove undefined values from object (for exactOptionalPropertyTypes)
// =============================================================================

/**
 * Removes keys with undefined values from an object.
 * This is needed because TypeScript's exactOptionalPropertyTypes
 * means optional properties cannot have `undefined` as a value.
 */
function omitUndefined<T extends object>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

// =============================================================================
// Primitive Generators
// =============================================================================

/** UUID v4 generator (specifically version 4 for consistency) */
export const arbUUID = fc.uuidV(4);

/** Date within reasonable range for medical records */
export const arbDate = fc.date({
  min: new Date("2020-01-01"),
  max: new Date("2030-01-01"),
});

/** Ordered date pair where earlier <= later */
export const arbDatePair = fc
  .tuple(arbDate, arbDate)
  .map(([a, b]) =>
    a <= b ? { earlier: a, later: b } : { earlier: b, later: a }
  );

/** Non-empty trimmed string */
export const arbNonEmptyString = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Email address */
export const arbEmail = fc.emailAddress();

/** Positive number for costs (using 32-bit float bounds) */
export const arbPositiveCost = fc.float({
  min: Math.fround(0.01),
  max: Math.fround(100000),
  noNaN: true,
});

// =============================================================================
// Domain Enum Generators
// =============================================================================

export const arbPatientRelationship: fc.Arbitrary<PatientRelationship> =
  fc.constantFrom("Employee", "Member", "Beneficiary");

export const arbIllnessType: fc.Arbitrary<IllnessType> = fc.constantFrom(
  "acute",
  "chronic"
);

export const arbTreatmentType: fc.Arbitrary<TreatmentType> = fc.constantFrom(
  ...TREATMENT_TYPES
);

export const arbFacilityType: fc.Arbitrary<FacilityType> = fc.constantFrom(
  "Outpatient",
  "Inpatient"
);

export const arbEvidenceType: fc.Arbitrary<EvidenceType> = fc.constantFrom(
  ...EVIDENCE_TYPES
);

export const arbClaimType: fc.Arbitrary<ClaimType> = fc.constantFrom(
  ...CLAIM_TYPES
);

export const arbClaimStatus: fc.Arbitrary<ClaimStatus> = fc.constantFrom(
  ...CLAIM_STATUSES
);

export const arbCountry = fc.constantFrom(...COUNTRIES);

export const arbCurrency = fc.constantFrom(...CURRENCIES);

export const arbAllowedMimeType: fc.Arbitrary<AllowedMimeType> = fc.constantFrom(
  "image/bmp",
  "application/pdf",
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/gif"
);

// =============================================================================
// Entity Generators
// =============================================================================

/** Generator for Patient with valid temporal invariants */
export const arbPatient: fc.Arbitrary<Patient> = fc
  .record({
    id: arbUUID,
    cignaId: fc.stringMatching(/^[0-9]{11}$/),
    name: arbNonEmptyString.map((s) => s.toUpperCase()),
    relationship: arbPatientRelationship,
    dateOfBirth: fc.date({ min: new Date("1920-01-01"), max: new Date("2010-01-01") }),
    citizenship: fc.option(arbNonEmptyString.map((s) => s.toUpperCase()), { nil: undefined }),
    workLocation: fc.option(arbNonEmptyString.map((s) => s.toUpperCase()), { nil: undefined }),
    email: fc.option(arbEmail, { nil: undefined }),
    timestamps: arbDatePair,
  })
  .map(({ timestamps, ...rest }) =>
    omitUndefined({
      ...rest,
      createdAt: timestamps.earlier,
      updatedAt: timestamps.later,
    })
  ) as fc.Arbitrary<Patient>;

/** Generator for Illness with valid temporal invariants */
export const arbIllness: fc.Arbitrary<Illness> = fc
  .record({
    id: arbUUID,
    patientId: arbUUID,
    name: arbNonEmptyString,
    icdCode: fc.option(arbNonEmptyString.map((s) => s.toUpperCase()), { nil: undefined }),
    type: arbIllnessType,
    onsetDate: fc.option(arbDate, { nil: undefined }),
    resolvedDate: fc.option(arbDate, { nil: undefined }),
    notes: fc.option(arbNonEmptyString, { nil: undefined }),
    timestamps: arbDatePair,
  })
  .map(({ timestamps, onsetDate, resolvedDate, ...rest }) => {
    // Ensure onsetDate <= resolvedDate when both present
    let validOnset = onsetDate;
    let validResolved = resolvedDate;
    if (onsetDate && resolvedDate && onsetDate > resolvedDate) {
      validOnset = resolvedDate;
      validResolved = onsetDate;
    }
    return omitUndefined({
      ...rest,
      onsetDate: validOnset,
      resolvedDate: validResolved,
      createdAt: timestamps.earlier,
      updatedAt: timestamps.later,
    });
  }) as fc.Arbitrary<Illness>;

/** Generator for Treatment with valid temporal invariants */
export const arbTreatment: fc.Arbitrary<Treatment> = fc
  .record({
    id: arbUUID,
    patientId: arbUUID,
    illnessId: arbUUID,
    treatmentDate: arbDate,
    treatmentTypes: fc.array(arbTreatmentType, { minLength: 1, maxLength: 5 }),
    country: arbCountry,
    facilityType: arbFacilityType,
    cost: arbPositiveCost,
    currency: arbCurrency,
    isWorkRelated: fc.boolean(),
    providerName: fc.option(arbNonEmptyString, { nil: undefined }),
    providerAddress: fc.option(arbNonEmptyString, { nil: undefined }),
    notes: fc.option(arbNonEmptyString, { nil: undefined }),
    timestamps: arbDatePair,
  })
  .map(({ timestamps, ...rest }) =>
    omitUndefined({
      ...rest,
      createdAt: timestamps.earlier,
      updatedAt: timestamps.later,
    })
  ) as fc.Arbitrary<Treatment>;

/** Generator for Evidence with valid temporal invariants */
export const arbEvidence: fc.Arbitrary<Evidence> = fc
  .record({
    id: arbUUID,
    treatmentId: arbUUID,
    type: arbEvidenceType,
    filePath: fc.option(arbNonEmptyString, { nil: undefined }),
    fileName: fc.option(arbNonEmptyString, { nil: undefined }),
    fileSize: fc.option(fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }), { nil: undefined }),
    mimeType: fc.option(arbAllowedMimeType, { nil: undefined }),
    sourceUrl: fc.option(fc.webUrl(), { nil: undefined }),
    date: arbDate,
    description: fc.option(arbNonEmptyString, { nil: undefined }),
    content: fc.option(arbNonEmptyString, { nil: undefined }),
    verified: fc.boolean(),
    timestamps: arbDatePair,
  })
  .map(({ timestamps, ...rest }) =>
    omitUndefined({
      ...rest,
      createdAt: timestamps.earlier,
      updatedAt: timestamps.later,
    })
  ) as fc.Arbitrary<Evidence>;

/** Generator for Symptom */
export const arbSymptom: fc.Arbitrary<Symptom> = fc.record({
  name: arbNonEmptyString.map((s) => s.toUpperCase()),
  description: arbNonEmptyString.map((s) => s.toUpperCase()),
});

/** Generator for Claim with valid temporal and domain invariants */
export const arbClaim: fc.Arbitrary<Claim> = fc
  .record({
    id: arbUUID,
    patientId: arbUUID,
    treatmentIds: fc.array(arbUUID, { minLength: 1, maxLength: 10 }),
    claimType: arbClaimType,
    status: arbClaimStatus,
    cignaClaimId: fc.option(fc.stringMatching(/^CLM-[0-9]{10}$/), { nil: undefined }),
    symptoms: fc.array(arbSymptom, { minLength: 0, maxLength: 3 }), // Max 3 symptoms
    totalAmount: arbPositiveCost,
    currency: arbCurrency,
    country: arbCountry,
    submittedAt: fc.option(arbDate, { nil: undefined }),
    processedAt: fc.option(arbDate, { nil: undefined }),
    approvedAmount: fc.option(arbPositiveCost, { nil: undefined }),
    rejectionReason: fc.option(arbNonEmptyString, { nil: undefined }),
    notes: fc.option(arbNonEmptyString, { nil: undefined }),
    timestamps: arbDatePair,
  })
  .map(({ timestamps, submittedAt, processedAt, ...rest }) => {
    // Ensure submittedAt <= processedAt when both present
    let validSubmitted = submittedAt;
    let validProcessed = processedAt;
    if (submittedAt && processedAt && submittedAt > processedAt) {
      validSubmitted = processedAt;
      validProcessed = submittedAt;
    }
    return omitUndefined({
      ...rest,
      submittedAt: validSubmitted,
      processedAt: validProcessed,
      createdAt: timestamps.earlier,
      updatedAt: timestamps.later,
    });
  }) as fc.Arbitrary<Claim>;

/** Generator for ClaimDocument */
export const arbClaimDocument: fc.Arbitrary<ClaimDocument> = fc
  .record({
    id: arbUUID,
    claimId: arbUUID,
    evidenceId: fc.option(arbUUID, { nil: undefined }),
    fileName: fc
      .tuple(
        arbNonEmptyString,
        fc.constantFrom(...ALLOWED_FILE_EXTENSIONS)
      )
      .map(([name, ext]) => `${name}${ext}`),
    fileSize: fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
    mimeType: arbAllowedMimeType,
    filePath: arbNonEmptyString.map((s) => `/uploads/${s}`),
    order: fc.integer({ min: 0, max: 100 }),
    uploadedAt: arbDate,
  })
  .map((obj) => omitUndefined(obj)) as fc.Arbitrary<ClaimDocument>;

// =============================================================================
// State Machine Generators
// =============================================================================

/**
 * Valid ClaimStatus transitions (state machine edges).
 * Used for property testing that random walks follow valid paths.
 */
export const VALID_STATUS_TRANSITIONS: ReadonlyMap<ClaimStatus, readonly ClaimStatus[]> =
  new Map([
    ["draft", ["ready"]],
    ["ready", ["submitted", "draft"]], // Can go back to draft
    ["submitted", ["processing"]],
    ["processing", ["approved", "rejected"]],
    ["approved", ["paid"]],
    ["rejected", []], // Terminal state
    ["paid", []], // Terminal state
  ]);

/** Generator for a valid status transition pair */
export const arbValidStatusTransition: fc.Arbitrary<{
  from: ClaimStatus;
  to: ClaimStatus;
}> = fc
  .constantFrom(...CLAIM_STATUSES)
  .filter((status) => {
    const transitions = VALID_STATUS_TRANSITIONS.get(status);
    return transitions !== undefined && transitions.length > 0;
  })
  .chain((from) => {
    const transitions = VALID_STATUS_TRANSITIONS.get(from)!;
    return fc.constantFrom(...transitions).map((to) => ({ from, to }));
  });

/** Generator for a random walk through valid status transitions */
export const arbStatusWalk = (maxSteps: number): fc.Arbitrary<ClaimStatus[]> =>
  fc.array(fc.boolean(), { minLength: 1, maxLength: maxSteps }).map((decisions) => {
    const walk: ClaimStatus[] = ["draft"];
    let current: ClaimStatus = "draft";

    for (const _ of decisions) {
      const transitions = VALID_STATUS_TRANSITIONS.get(current);
      if (!transitions || transitions.length === 0) break;
      // Pick first valid transition (deterministic for shrinking)
      current = transitions[0]!;
      walk.push(current);
    }

    return walk;
  });
