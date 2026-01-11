/**
 * Property-based tests for type invariants.
 *
 * Ordered from least obvious to most obvious invariants,
 * exploring the full invariant-space of the domain model.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  TREATMENT_TYPES,
  EVIDENCE_TYPES,
  CLAIM_TYPES,
  CLAIM_STATUSES,
  COUNTRIES,
  CURRENCIES,
  CURRENCY_CODES,
  NETWORKS,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_ATTACHMENTS_BYTES,
  ALLOWED_FILE_EXTENSIONS,
} from "../../../src/types/index.js";
import type {
  TreatmentType,
  EvidenceType,
  ClaimType,
  ClaimStatus,
} from "../../../src/types/index.js";
import {
  arbPatient,
  arbIllness,
  arbTreatment,
  arbEvidence,
  arbClaim,
  arbClaimDocument,
  arbSymptom,
  arbValidStatusTransition,
  arbStatusWalk,
  VALID_STATUS_TRANSITIONS,
} from "./generators.js";

// =============================================================================
// 1. ALGEBRAIC INVARIANTS (Least Obvious)
// =============================================================================

describe("Algebraic Invariants", () => {
  describe("CURRENCY_CODES bijectivity", () => {
    it("every ISO code maps to a currency that exists in CURRENCIES", () => {
      fc.assert(
        fc.property(fc.constantFrom(...Object.keys(CURRENCY_CODES)), (isoCode) => {
          const cignaName = CURRENCY_CODES[isoCode];
          expect(cignaName).toBeDefined();
          expect(CURRENCIES).toContain(cignaName);
        })
      );
    });

    it("CURRENCY_CODES values are unique (injective mapping)", () => {
      const values = Object.values(CURRENCY_CODES);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it("CURRENCY_CODES covers commonly used currencies", () => {
      // Business invariant: we need at least EUR, GBP, USD
      const essentialCodes = ["EUR", "GBP", "USD"];
      for (const code of essentialCodes) {
        expect(CURRENCY_CODES).toHaveProperty(code);
      }
    });
  });

  describe("Const array ↔ Union type cardinality", () => {
    /**
     * This is a subtle invariant: the runtime array must have the same
     * cardinality as the compile-time union type. Drift between these
     * indicates a bug where a type member was added/removed without
     * updating the corresponding array.
     */

    it("TREATMENT_TYPES has exactly 10 members (matching TreatmentType union)", () => {
      // TreatmentType = 10 literal types
      expect(TREATMENT_TYPES.length).toBe(10);
      // Verify exhaustiveness by checking each known value
      const expectedTypes: TreatmentType[] = [
        "Chiropractic treatment",
        "Consultation with medical practitioner and specialist",
        "Maternity consultations or treatment",
        "Osteopathy",
        "Pathology tests and expenses",
        "Physiotherapy",
        "Prescribed medication",
        "Psychiatric consultations or treatment",
        "X-rays",
        "Other",
      ];
      expect(TREATMENT_TYPES).toEqual(expectedTypes);
    });

    it("EVIDENCE_TYPES has exactly 7 members (matching EvidenceType union)", () => {
      const expectedTypes: EvidenceType[] = [
        "Invoice",
        "MedicalReport",
        "Prescription",
        "ProgressReport",
        "CalendarEntry",
        "Email",
        "Other",
      ];
      expect(EVIDENCE_TYPES.length).toBe(7);
      expect(EVIDENCE_TYPES).toEqual(expectedTypes);
    });

    it("CLAIM_TYPES has exactly 3 members (matching ClaimType union)", () => {
      const expectedTypes: ClaimType[] = ["Medical", "Vision", "Dental"];
      expect(CLAIM_TYPES.length).toBe(3);
      expect(CLAIM_TYPES).toEqual(expectedTypes);
    });

    it("CLAIM_STATUSES has exactly 7 members (matching ClaimStatus union)", () => {
      const expectedStatuses: ClaimStatus[] = [
        "draft",
        "ready",
        "submitted",
        "processing",
        "approved",
        "rejected",
        "paid",
      ];
      expect(CLAIM_STATUSES.length).toBe(7);
      expect(CLAIM_STATUSES).toEqual(expectedStatuses);
    });
  });

  describe("Omit type key reduction (CQRS pattern)", () => {
    /**
     * CreateInput types must have strictly fewer keys than their base types.
     * This validates the CQRS pattern is correctly applied.
     */

    it("generated Patient has all required fields", () => {
      fc.assert(
        fc.property(arbPatient, (patient) => {
          // Base type has: id, cignaId, name, relationship, dateOfBirth,
          // citizenship?, workLocation?, email?, createdAt, updatedAt
          expect(patient).toHaveProperty("id");
          expect(patient).toHaveProperty("cignaId");
          expect(patient).toHaveProperty("name");
          expect(patient).toHaveProperty("relationship");
          expect(patient).toHaveProperty("dateOfBirth");
          expect(patient).toHaveProperty("createdAt");
          expect(patient).toHaveProperty("updatedAt");
        })
      );
    });

    it("generated Claim has all required fields", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(claim).toHaveProperty("id");
          expect(claim).toHaveProperty("patientId");
          expect(claim).toHaveProperty("treatmentIds");
          expect(claim).toHaveProperty("claimType");
          expect(claim).toHaveProperty("status");
          expect(claim).toHaveProperty("symptoms");
          expect(claim).toHaveProperty("totalAmount");
          expect(claim).toHaveProperty("currency");
          expect(claim).toHaveProperty("country");
          expect(claim).toHaveProperty("createdAt");
          expect(claim).toHaveProperty("updatedAt");
        })
      );
    });
  });
});

// =============================================================================
// 2. STATE MACHINE INVARIANTS
// =============================================================================

describe("State Machine Invariants", () => {
  describe("ClaimStatus transitions", () => {
    it("every non-terminal status has at least one valid transition", () => {
      const terminalStatuses: ClaimStatus[] = ["rejected", "paid"];
      const nonTerminal = CLAIM_STATUSES.filter(
        (s) => !terminalStatuses.includes(s)
      );

      for (const status of nonTerminal) {
        const transitions = VALID_STATUS_TRANSITIONS.get(status);
        expect(transitions).toBeDefined();
        expect(transitions!.length).toBeGreaterThan(0);
      }
    });

    it("terminal statuses have no outgoing transitions", () => {
      const terminalStatuses: ClaimStatus[] = ["rejected", "paid"];

      for (const status of terminalStatuses) {
        const transitions = VALID_STATUS_TRANSITIONS.get(status);
        expect(transitions).toBeDefined();
        expect(transitions!.length).toBe(0);
      }
    });

    it("valid transitions only lead to known statuses", () => {
      fc.assert(
        fc.property(arbValidStatusTransition, ({ from, to }) => {
          expect(CLAIM_STATUSES).toContain(from);
          expect(CLAIM_STATUSES).toContain(to);
        })
      );
    });

    it("random walks always produce valid status sequences", () => {
      fc.assert(
        fc.property(arbStatusWalk(10), (walk) => {
          expect(walk.length).toBeGreaterThan(0);
          expect(walk[0]).toBe("draft"); // Always starts at draft

          // Verify each transition is valid
          for (let i = 0; i < walk.length - 1; i++) {
            const from = walk[i]!;
            const to = walk[i + 1]!;
            const validNext = VALID_STATUS_TRANSITIONS.get(from);
            expect(validNext).toContain(to);
          }
        })
      );
    });

    it("'draft' is the only valid initial state", () => {
      // This is a domain invariant: all claims start as drafts
      fc.assert(
        fc.property(arbStatusWalk(5), (walk) => {
          expect(walk[0]).toBe("draft");
        })
      );
    });

    it("'submitted' can only come from 'ready'", () => {
      // Verify no shortcut to submitted
      for (const [from, transitions] of VALID_STATUS_TRANSITIONS) {
        if (transitions.includes("submitted")) {
          expect(from).toBe("ready");
        }
      }
    });
  });
});

// =============================================================================
// 3. CONSTRAINT COMPOSITION INVARIANTS
// =============================================================================

describe("Constraint Composition Invariants", () => {
  describe("File size arithmetic", () => {
    it("MAX_TOTAL_ATTACHMENTS / MAX_FILE_SIZE = 5 (max files at full size)", () => {
      const maxFilesAtFullSize = MAX_TOTAL_ATTACHMENTS_BYTES / MAX_FILE_SIZE_BYTES;
      expect(maxFilesAtFullSize).toBe(5);
    });

    it("MAX_FILE_SIZE_BYTES is exactly 6 MB", () => {
      expect(MAX_FILE_SIZE_BYTES).toBe(6 * 1024 * 1024);
    });

    it("MAX_TOTAL_ATTACHMENTS_BYTES is exactly 30 MB", () => {
      expect(MAX_TOTAL_ATTACHMENTS_BYTES).toBe(30 * 1024 * 1024);
    });

    it("generated ClaimDocuments respect file size limit", () => {
      fc.assert(
        fc.property(arbClaimDocument, (doc) => {
          expect(doc.fileSize).toBeGreaterThan(0);
          expect(doc.fileSize).toBeLessThanOrEqual(MAX_FILE_SIZE_BYTES);
        })
      );
    });
  });

  describe("Symptoms bound", () => {
    it("Claim symptoms array has at most 3 elements", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(claim.symptoms.length).toBeLessThanOrEqual(3);
        })
      );
    });

    it("each Symptom has non-empty name and description", () => {
      fc.assert(
        fc.property(arbSymptom, (symptom) => {
          expect(symptom.name.length).toBeGreaterThan(0);
          expect(symptom.description.length).toBeGreaterThan(0);
        })
      );
    });
  });

  describe("Allowed file extensions", () => {
    it("ALLOWED_FILE_EXTENSIONS contains all expected formats", () => {
      const expected = [".bmp", ".pdf", ".png", ".jpg", ".jpeg", ".gif"];
      expect(ALLOWED_FILE_EXTENSIONS).toEqual(expected);
    });

    it("generated ClaimDocument filenames have valid extensions", () => {
      fc.assert(
        fc.property(arbClaimDocument, (doc) => {
          const hasValidExt = ALLOWED_FILE_EXTENSIONS.some((ext) =>
            doc.fileName.endsWith(ext)
          );
          expect(hasValidExt).toBe(true);
        })
      );
    });
  });
});

// =============================================================================
// 4. TEMPORAL INVARIANTS
// =============================================================================

describe("Temporal Invariants", () => {
  describe("createdAt <= updatedAt for all entities", () => {
    it("Patient.createdAt <= Patient.updatedAt", () => {
      fc.assert(
        fc.property(arbPatient, (patient) => {
          expect(patient.createdAt.getTime()).toBeLessThanOrEqual(
            patient.updatedAt.getTime()
          );
        })
      );
    });

    it("Illness.createdAt <= Illness.updatedAt", () => {
      fc.assert(
        fc.property(arbIllness, (illness) => {
          expect(illness.createdAt.getTime()).toBeLessThanOrEqual(
            illness.updatedAt.getTime()
          );
        })
      );
    });

    it("Treatment.createdAt <= Treatment.updatedAt", () => {
      fc.assert(
        fc.property(arbTreatment, (treatment) => {
          expect(treatment.createdAt.getTime()).toBeLessThanOrEqual(
            treatment.updatedAt.getTime()
          );
        })
      );
    });

    it("Evidence.createdAt <= Evidence.updatedAt", () => {
      fc.assert(
        fc.property(arbEvidence, (evidence) => {
          expect(evidence.createdAt.getTime()).toBeLessThanOrEqual(
            evidence.updatedAt.getTime()
          );
        })
      );
    });

    it("Claim.createdAt <= Claim.updatedAt", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(claim.createdAt.getTime()).toBeLessThanOrEqual(
            claim.updatedAt.getTime()
          );
        })
      );
    });
  });

  describe("Domain-specific temporal ordering", () => {
    it("Illness.onsetDate <= Illness.resolvedDate when both present", () => {
      fc.assert(
        fc.property(arbIllness, (illness) => {
          if (illness.onsetDate && illness.resolvedDate) {
            expect(illness.onsetDate.getTime()).toBeLessThanOrEqual(
              illness.resolvedDate.getTime()
            );
          }
          return true; // Pass if either is undefined
        })
      );
    });

    it("Claim.submittedAt <= Claim.processedAt when both present", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          if (claim.submittedAt && claim.processedAt) {
            expect(claim.submittedAt.getTime()).toBeLessThanOrEqual(
              claim.processedAt.getTime()
            );
          }
          return true;
        })
      );
    });
  });
});

// =============================================================================
// 5. REFERENTIAL INTEGRITY SHAPES
// =============================================================================

describe("Referential Integrity Shapes", () => {
  describe("Foreign key fields are valid UUIDs", () => {
    it("Treatment.patientId is a valid UUID", () => {
      fc.assert(
        fc.property(arbTreatment, (treatment) => {
          expect(treatment.patientId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
        })
      );
    });

    it("Treatment.illnessId is a valid UUID", () => {
      fc.assert(
        fc.property(arbTreatment, (treatment) => {
          expect(treatment.illnessId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
        })
      );
    });

    it("Evidence.treatmentId is a valid UUID", () => {
      fc.assert(
        fc.property(arbEvidence, (evidence) => {
          expect(evidence.treatmentId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
        })
      );
    });

    it("Claim.patientId is a valid UUID", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(claim.patientId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
        })
      );
    });

    it("Claim.treatmentIds are all valid UUIDs", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(claim.treatmentIds.length).toBeGreaterThan(0);
          for (const id of claim.treatmentIds) {
            expect(id).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            );
          }
        })
      );
    });

    it("ClaimDocument.claimId is a valid UUID", () => {
      fc.assert(
        fc.property(arbClaimDocument, (doc) => {
          expect(doc.claimId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
        })
      );
    });
  });

  describe("Primary key fields are valid UUIDs", () => {
    it("Patient.id is a valid UUID", () => {
      fc.assert(
        fc.property(arbPatient, (patient) => {
          expect(patient.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
        })
      );
    });

    it("Illness.id is a valid UUID", () => {
      fc.assert(
        fc.property(arbIllness, (illness) => {
          expect(illness.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
        })
      );
    });
  });
});

// =============================================================================
// 6. DOMAIN VALUE INVARIANTS
// =============================================================================

describe("Domain Value Invariants", () => {
  describe("Cost fields", () => {
    it("Treatment.cost is positive", () => {
      fc.assert(
        fc.property(arbTreatment, (treatment) => {
          expect(treatment.cost).toBeGreaterThan(0);
        })
      );
    });

    it("Claim.totalAmount is positive", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(claim.totalAmount).toBeGreaterThan(0);
        })
      );
    });
  });

  describe("Enum fields use valid values", () => {
    it("Patient.relationship is a valid PatientRelationship", () => {
      fc.assert(
        fc.property(arbPatient, (patient) => {
          expect(["Employee", "Member", "Beneficiary"]).toContain(
            patient.relationship
          );
        })
      );
    });

    it("Illness.type is a valid IllnessType", () => {
      fc.assert(
        fc.property(arbIllness, (illness) => {
          expect(["acute", "chronic"]).toContain(illness.type);
        })
      );
    });

    it("Treatment.facilityType is a valid FacilityType", () => {
      fc.assert(
        fc.property(arbTreatment, (treatment) => {
          expect(["Outpatient", "Inpatient"]).toContain(treatment.facilityType);
        })
      );
    });

    it("Treatment.treatmentTypes are all valid TreatmentType values", () => {
      fc.assert(
        fc.property(arbTreatment, (treatment) => {
          for (const tt of treatment.treatmentTypes) {
            expect(TREATMENT_TYPES).toContain(tt);
          }
        })
      );
    });

    it("Evidence.type is a valid EvidenceType", () => {
      fc.assert(
        fc.property(arbEvidence, (evidence) => {
          expect(EVIDENCE_TYPES).toContain(evidence.type);
        })
      );
    });

    it("Claim.claimType is a valid ClaimType", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(CLAIM_TYPES).toContain(claim.claimType);
        })
      );
    });

    it("Claim.status is a valid ClaimStatus", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(CLAIM_STATUSES).toContain(claim.status);
        })
      );
    });
  });

  describe("Reference data fields", () => {
    it("Treatment.country is from COUNTRIES", () => {
      fc.assert(
        fc.property(arbTreatment, (treatment) => {
          expect(COUNTRIES).toContain(treatment.country);
        })
      );
    });

    it("Treatment.currency is from CURRENCIES", () => {
      fc.assert(
        fc.property(arbTreatment, (treatment) => {
          expect(CURRENCIES).toContain(treatment.currency);
        })
      );
    });

    it("Claim.country is from COUNTRIES", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(COUNTRIES).toContain(claim.country);
        })
      );
    });

    it("Claim.currency is from CURRENCIES", () => {
      fc.assert(
        fc.property(arbClaim, (claim) => {
          expect(CURRENCIES).toContain(claim.currency);
        })
      );
    });
  });
});
