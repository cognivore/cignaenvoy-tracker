/**
 * Structural tests for type exports, constants, and uniqueness.
 *
 * These are "normal" tests that verify the basic structure of the type system.
 */

import { describe, it, expect } from "vitest";
import {
  // Re-export constants
  TREATMENT_TYPES,
  EVIDENCE_TYPES,
  CLAIM_TYPES,
  CLAIM_STATUSES,
  COUNTRIES,
  CURRENCIES,
  CURRENCY_CODES,
  NETWORKS,
  ALLOWED_FILE_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_ATTACHMENTS_BYTES,
} from "../../../src/types/index.js";

// Type imports for compile-time verification
import type {
  Patient,
  PatientRelationship,
  CreatePatientInput,
  UpdatePatientInput,
  Illness,
  IllnessType,
  CreateIllnessInput,
  UpdateIllnessInput,
  Treatment,
  TreatmentType,
  FacilityType,
  CreateTreatmentInput,
  UpdateTreatmentInput,
  Evidence,
  EvidenceType,
  CreateEvidenceInput,
  UpdateEvidenceInput,
  Claim,
  ClaimType,
  ClaimStatus,
  Symptom,
  ClaimDocument,
  AllowedMimeType,
  CreateClaimInput,
  UpdateClaimInput,
  CreateClaimDocumentInput,
  Country,
  Currency,
  Network,
} from "../../../src/types/index.js";

// =============================================================================
// TYPE EXPORT VERIFICATION (Compile-time tests)
// =============================================================================

describe("Type Exports", () => {
  describe("Patient module exports", () => {
    it("exports Patient type", () => {
      // TypeScript compile-time check: if this compiles, the type exists
      const _typeCheck: Patient = {
        id: "test",
        cignaId: "12345678901",
        name: "TEST",
        relationship: "Employee",
        dateOfBirth: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(_typeCheck).toBeDefined();
    });

    it("exports PatientRelationship type", () => {
      const _rel: PatientRelationship = "Employee";
      expect(["Employee", "Member", "Beneficiary"]).toContain(_rel);
    });

    it("exports CreatePatientInput type", () => {
      const _input: CreatePatientInput = {
        cignaId: "12345678901",
        name: "TEST",
        relationship: "Employee",
        dateOfBirth: new Date(),
      };
      expect(_input).toBeDefined();
      // Verify 'id' is not required (it's Omit-ed)
      expect(_input).not.toHaveProperty("id");
    });

    it("exports UpdatePatientInput type", () => {
      const _input: UpdatePatientInput = { name: "UPDATED" };
      expect(_input).toBeDefined();
    });
  });

  describe("Illness module exports", () => {
    it("exports Illness type", () => {
      const _illness: Illness = {
        id: "test",
        patientId: "patient-id",
        name: "Anxiety",
        type: "chronic",
        relevantAccounts: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(_illness).toBeDefined();
    });

    it("exports IllnessType type", () => {
      const _type: IllnessType = "acute";
      expect(["acute", "chronic"]).toContain(_type);
    });
  });

  describe("Treatment module exports", () => {
    it("exports Treatment type", () => {
      const _treatment: Treatment = {
        id: "test",
        patientId: "patient-id",
        illnessId: "illness-id",
        treatmentDate: new Date(),
        treatmentTypes: ["Prescribed medication"],
        country: "UNITED KINGDOM",
        facilityType: "Outpatient",
        cost: 100,
        currency: "BRITISH POUND STERLING",
        isWorkRelated: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(_treatment).toBeDefined();
    });

    it("exports TreatmentType type", () => {
      const _type: TreatmentType = "Prescribed medication";
      expect(TREATMENT_TYPES).toContain(_type);
    });

    it("exports FacilityType type", () => {
      const _type: FacilityType = "Outpatient";
      expect(["Outpatient", "Inpatient"]).toContain(_type);
    });
  });

  describe("Evidence module exports", () => {
    it("exports Evidence type", () => {
      const _evidence: Evidence = {
        id: "test",
        treatmentId: "treatment-id",
        type: "Invoice",
        date: new Date(),
        verified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(_evidence).toBeDefined();
    });

    it("exports EvidenceType type", () => {
      const _type: EvidenceType = "Invoice";
      expect(EVIDENCE_TYPES).toContain(_type);
    });
  });

  describe("Claim module exports", () => {
    it("exports Claim type", () => {
      const _claim: Claim = {
        id: "test",
        patientId: "patient-id",
        treatmentIds: ["treatment-1"],
        claimType: "Medical",
        status: "draft",
        symptoms: [],
        totalAmount: 100,
        currency: "EUROPEAN MONETARY UNION EURO",
        country: "LATVIA",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(_claim).toBeDefined();
    });

    it("exports ClaimType type", () => {
      const _type: ClaimType = "Medical";
      expect(CLAIM_TYPES).toContain(_type);
    });

    it("exports ClaimStatus type", () => {
      const _status: ClaimStatus = "draft";
      expect(CLAIM_STATUSES).toContain(_status);
    });

    it("exports Symptom type", () => {
      const _symptom: Symptom = {
        name: "ANXIETY",
        description: "ANXIETY DISORDER, UNSPECIFIED",
      };
      expect(_symptom).toBeDefined();
    });

    it("exports ClaimDocument type", () => {
      const _doc: ClaimDocument = {
        id: "test",
        claimId: "claim-id",
        fileName: "invoice.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        filePath: "/uploads/invoice.pdf",
        order: 0,
        uploadedAt: new Date(),
      };
      expect(_doc).toBeDefined();
    });

    it("exports AllowedMimeType type", () => {
      const _mime: AllowedMimeType = "application/pdf";
      expect(_mime).toBeDefined();
    });
  });

  describe("Reference module exports", () => {
    it("exports Country type", () => {
      const _country: Country = "UNITED KINGDOM";
      expect(_country).toBeDefined();
    });

    it("exports Currency type", () => {
      const _currency: Currency = "EUROPEAN MONETARY UNION EURO";
      expect(_currency).toBeDefined();
    });

    it("exports Network type", () => {
      const _network: Network = "CHC PPO";
      expect(NETWORKS).toContain(_network);
    });
  });
});

// =============================================================================
// CONST ARRAY TESTS
// =============================================================================

describe("Const Arrays", () => {
  describe("Non-emptiness", () => {
    it("TREATMENT_TYPES is non-empty", () => {
      expect(TREATMENT_TYPES.length).toBeGreaterThan(0);
    });

    it("EVIDENCE_TYPES is non-empty", () => {
      expect(EVIDENCE_TYPES.length).toBeGreaterThan(0);
    });

    it("CLAIM_TYPES is non-empty", () => {
      expect(CLAIM_TYPES.length).toBeGreaterThan(0);
    });

    it("CLAIM_STATUSES is non-empty", () => {
      expect(CLAIM_STATUSES.length).toBeGreaterThan(0);
    });

    it("COUNTRIES is non-empty", () => {
      expect(COUNTRIES.length).toBeGreaterThan(0);
    });

    it("CURRENCIES is non-empty", () => {
      expect(CURRENCIES.length).toBeGreaterThan(0);
    });

    it("NETWORKS is non-empty", () => {
      expect(NETWORKS.length).toBeGreaterThan(0);
    });

    it("ALLOWED_FILE_EXTENSIONS is non-empty", () => {
      expect(ALLOWED_FILE_EXTENSIONS.length).toBeGreaterThan(0);
    });
  });

  describe("Readonly at type level (as const)", () => {
    /**
     * Note: `as const` in TypeScript only creates readonly types at compile time.
     * The arrays are NOT frozen at runtime. This is a TypeScript limitation.
     * The type system prevents mutation, but Object.isFrozen returns false.
     */
    it("TREATMENT_TYPES is a readonly array type", () => {
      // This test verifies the array exists and is typed correctly
      // Runtime immutability would require Object.freeze() which is not done
      expect(Array.isArray(TREATMENT_TYPES)).toBe(true);
      expect(TREATMENT_TYPES.length).toBe(10);
    });

    it("COUNTRIES is a readonly array type", () => {
      expect(Array.isArray(COUNTRIES)).toBe(true);
      expect(COUNTRIES.length).toBeGreaterThan(0);
    });

    it("CURRENCIES is a readonly array type", () => {
      expect(Array.isArray(CURRENCIES)).toBe(true);
      expect(CURRENCIES.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// REFERENCE DATA UNIQUENESS
// =============================================================================

describe("Reference Data Uniqueness", () => {
  it("COUNTRIES has no duplicates", () => {
    const uniqueCountries = new Set(COUNTRIES);
    expect(uniqueCountries.size).toBe(COUNTRIES.length);
  });

  it("CURRENCIES has no duplicates", () => {
    const uniqueCurrencies = new Set(CURRENCIES);
    expect(uniqueCurrencies.size).toBe(CURRENCIES.length);
  });

  it("TREATMENT_TYPES has no duplicates", () => {
    const unique = new Set(TREATMENT_TYPES);
    expect(unique.size).toBe(TREATMENT_TYPES.length);
  });

  it("EVIDENCE_TYPES has no duplicates", () => {
    const unique = new Set(EVIDENCE_TYPES);
    expect(unique.size).toBe(EVIDENCE_TYPES.length);
  });

  it("CLAIM_TYPES has no duplicates", () => {
    const unique = new Set(CLAIM_TYPES);
    expect(unique.size).toBe(CLAIM_TYPES.length);
  });

  it("CLAIM_STATUSES has no duplicates", () => {
    const unique = new Set(CLAIM_STATUSES);
    expect(unique.size).toBe(CLAIM_STATUSES.length);
  });

  it("NETWORKS has no duplicates", () => {
    const unique = new Set(NETWORKS);
    expect(unique.size).toBe(NETWORKS.length);
  });

  it("ALLOWED_FILE_EXTENSIONS has no duplicates", () => {
    const unique = new Set(ALLOWED_FILE_EXTENSIONS);
    expect(unique.size).toBe(ALLOWED_FILE_EXTENSIONS.length);
  });

  it("CURRENCY_CODES keys are unique", () => {
    const keys = Object.keys(CURRENCY_CODES);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

// =============================================================================
// CONSTANTS
// =============================================================================

describe("Constants", () => {
  describe("File size limits", () => {
    it("MAX_FILE_SIZE_BYTES is 6 MB", () => {
      expect(MAX_FILE_SIZE_BYTES).toBe(6 * 1024 * 1024);
      expect(MAX_FILE_SIZE_BYTES).toBe(6291456);
    });

    it("MAX_TOTAL_ATTACHMENTS_BYTES is 30 MB", () => {
      expect(MAX_TOTAL_ATTACHMENTS_BYTES).toBe(30 * 1024 * 1024);
      expect(MAX_TOTAL_ATTACHMENTS_BYTES).toBe(31457280);
    });

    it("file size limits are positive", () => {
      expect(MAX_FILE_SIZE_BYTES).toBeGreaterThan(0);
      expect(MAX_TOTAL_ATTACHMENTS_BYTES).toBeGreaterThan(0);
    });

    it("total limit is greater than individual limit", () => {
      expect(MAX_TOTAL_ATTACHMENTS_BYTES).toBeGreaterThan(MAX_FILE_SIZE_BYTES);
    });
  });

  describe("File extensions", () => {
    it("all extensions start with a dot", () => {
      for (const ext of ALLOWED_FILE_EXTENSIONS) {
        expect(ext.startsWith(".")).toBe(true);
      }
    });

    it("contains common image formats", () => {
      expect(ALLOWED_FILE_EXTENSIONS).toContain(".png");
      expect(ALLOWED_FILE_EXTENSIONS).toContain(".jpg");
      expect(ALLOWED_FILE_EXTENSIONS).toContain(".jpeg");
      expect(ALLOWED_FILE_EXTENSIONS).toContain(".gif");
    });

    it("contains PDF format", () => {
      expect(ALLOWED_FILE_EXTENSIONS).toContain(".pdf");
    });
  });
});

// =============================================================================
// REFERENCE DATA CONTENT
// =============================================================================

describe("Reference Data Content", () => {
  describe("COUNTRIES", () => {
    it("contains major countries", () => {
      const majorCountries = [
        "UNITED STATES",
        "UNITED KINGDOM",
        "GERMANY",
        "FRANCE",
        "JAPAN",
        "CHINA",
        "AUSTRALIA",
        "CANADA",
      ];
      for (const country of majorCountries) {
        expect(COUNTRIES).toContain(country);
      }
    });

    it("contains Latvia (the user's citizenship from plan)", () => {
      expect(COUNTRIES).toContain("LATVIA");
    });

    it("all country names are uppercase", () => {
      for (const country of COUNTRIES) {
        expect(country).toBe(country.toUpperCase());
      }
    });
  });

  describe("CURRENCIES", () => {
    it("contains major currencies", () => {
      const majorCurrencies = [
        "EUROPEAN MONETARY UNION EURO",
        "BRITISH POUND STERLING",
        "US DOLLAR",
        "JAPANESE YEN",
        "SWISS FRANC",
      ];
      for (const currency of majorCurrencies) {
        expect(CURRENCIES).toContain(currency);
      }
    });

    it("all currency names are uppercase", () => {
      for (const currency of CURRENCIES) {
        expect(currency).toBe(currency.toUpperCase());
      }
    });
  });

  describe("CURRENCY_CODES", () => {
    it("maps common ISO codes", () => {
      expect(CURRENCY_CODES.EUR).toBe("EUROPEAN MONETARY UNION EURO");
      expect(CURRENCY_CODES.GBP).toBe("BRITISH POUND STERLING");
      expect(CURRENCY_CODES.USD).toBe("US DOLLAR");
      expect(CURRENCY_CODES.JPY).toBe("JAPANESE YEN");
      expect(CURRENCY_CODES.CHF).toBe("SWISS FRANC");
    });

    it("all ISO codes are 3 uppercase letters", () => {
      for (const code of Object.keys(CURRENCY_CODES)) {
        expect(code).toMatch(/^[A-Z]{3}$/);
      }
    });
  });

  describe("NETWORKS", () => {
    it("contains expected network types", () => {
      expect(NETWORKS).toContain("CHC PPO");
      expect(NETWORKS).toContain("CHC HMO");
      expect(NETWORKS).toContain("Global");
    });
  });
});

// =============================================================================
// TYPE SYSTEM COHERENCE
// =============================================================================

describe("Type System Coherence", () => {
  describe("Input types exclude auto-generated fields", () => {
    it("CreatePatientInput does not require id, createdAt, updatedAt", () => {
      // This is a compile-time check. If it compiles, the types are correct.
      const minimal: CreatePatientInput = {
        cignaId: "12345678901",
        name: "TEST",
        relationship: "Employee",
        dateOfBirth: new Date(),
      };
      expect(minimal).not.toHaveProperty("id");
      expect(minimal).not.toHaveProperty("createdAt");
      expect(minimal).not.toHaveProperty("updatedAt");
    });

    it("CreateClaimInput does not require status or cignaClaimId", () => {
      const minimal: CreateClaimInput = {
        patientId: "patient-id",
        treatmentIds: ["treatment-1"],
        claimType: "Medical",
        symptoms: [],
        totalAmount: 100,
        currency: "EUROPEAN MONETARY UNION EURO",
        country: "LATVIA",
      };
      expect(minimal).not.toHaveProperty("status");
      expect(minimal).not.toHaveProperty("cignaClaimId");
      expect(minimal).not.toHaveProperty("submittedAt");
    });
  });

  describe("Update types are partial", () => {
    it("UpdatePatientInput allows partial updates", () => {
      const nameOnly: UpdatePatientInput = { name: "NEW NAME" };
      const emailOnly: UpdatePatientInput = { email: "new@example.com" };
      const multiple: UpdatePatientInput = { name: "NEW", citizenship: "UK" };

      expect(nameOnly).toBeDefined();
      expect(emailOnly).toBeDefined();
      expect(multiple).toBeDefined();
    });

    it("UpdateClaimInput allows partial updates", () => {
      const statusOnly: UpdateClaimInput = { status: "submitted" };
      const amountOnly: UpdateClaimInput = { totalAmount: 200 };

      expect(statusOnly).toBeDefined();
      expect(amountOnly).toBeDefined();
    });
  });
});
