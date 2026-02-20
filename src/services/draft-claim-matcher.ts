/**
 * Draft Claim to Scraped Claim Matcher
 *
 * COMPLETELY REWRITTEN for guaranteed matching.
 *
 * Matching Strategy (in order of priority):
 * 1. DIRECT LINK - Match by submissionNumber (100% confidence, guaranteed)
 * 2. DIRECT LINK - Match by scrapedClaimId reference (100% confidence)
 * 3. HEURISTIC - Match by amount + currency + patient + date (high confidence)
 * 4. HEURISTIC - Match by amount + currency + patient (medium confidence)
 *
 * The key insight: when a draft claim is submitted to Cigna, we can capture
 * the submissionNumber. When we scrape claims from Cigna, they have submissionNumbers.
 * Matching on submissionNumber is GUARANTEED to be correct.
 */

import type { ScrapedClaim } from "../types/scraped-claim.js";
import type { DraftClaim } from "../types/draft-claim.js";
import type { MedicalDocument } from "../types/medical-document.js";
import type { Patient } from "../types/patient.js";
import { claimsStorage as scrapedClaimsStorage } from "../storage/claims.js";
import { draftClaimsStorage, updateDraftClaim } from "../storage/draft-claims.js";
import { documentsStorage } from "../storage/documents.js";
import { patientsStorage } from "../storage/patients.js";
import { illnessesStorage } from "../storage/illnesses.js";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Confidence level for a match.
 * - "exact": Direct link via submissionNumber or scrapedClaimId (guaranteed)
 * - "high": All heuristics match (amount, currency, patient, date)
 * - "medium": Core heuristics match (amount, currency, patient)
 * - "low": Partial match (for review only, not auto-linkable)
 */
export type MatchConfidence = "exact" | "high" | "medium" | "low";

/**
 * Match result between a scraped claim and a draft claim.
 */
export interface DraftClaimMatch {
  scrapedClaimId: string;
  draftClaimId: string;
  confidence: MatchConfidence;
  matchMethod: "submission_number" | "scraped_claim_id" | "heuristic";
  matchDetails: {
    submissionNumberMatch: boolean;
    scrapedClaimIdMatch: boolean;
    amountMatch: boolean;
    currencyMatch: boolean;
    patientMatch: boolean;
    treatmentDateMatch: boolean;
    // Debug info
    draftAmount?: number;
    draftCurrency?: string;
    draftPatient?: string;
    draftTreatmentDate?: string;
    scrapedAmount?: number;
    scrapedCurrency?: string;
    scrapedPatient?: string;
    scrapedTreatmentDate?: string;
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Normalize patient name for comparison.
 * Handles: case, whitespace, common title variations.
 */
function normalizePatientName(name: string): string {
  return name
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(MR\.?|MRS\.?|MS\.?|DR\.?)\s+/i, ""); // Remove titles
}

/**
 * Check if two patient names match.
 * Handles partial matches (first+last vs full name).
 */
function patientNamesMatch(name1: string, name2: string): boolean {
  const n1 = normalizePatientName(name1);
  const n2 = normalizePatientName(name2);

  // Exact match
  if (n1 === n2) return true;

  // One contains the other (handles middle names, suffixes)
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Check if all words from one appear in the other
  const words1 = n1.split(" ").filter(w => w.length > 1);
  const words2 = n2.split(" ").filter(w => w.length > 1);

  const allWords1InWords2 = words1.every(w => words2.some(w2 => w2.includes(w) || w.includes(w2)));
  const allWords2InWords1 = words2.every(w => words1.some(w1 => w1.includes(w) || w.includes(w1)));

  return allWords1InWords2 || allWords2InWords1;
}

/**
 * Check if two dates are the same day.
 */
function isSameDay(date1: Date, date2: Date): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Check if treatment dates match, considering line items.
 * A draft's treatment date might match ANY line item date in the scraped claim.
 */
function treatmentDatesMatch(draftDate: Date | null, scraped: ScrapedClaim): boolean {
  if (!draftDate) return false;

  // Check primary treatment date
  if (isSameDay(draftDate, scraped.treatmentDate)) return true;

  // Check line item dates
  for (const lineItem of scraped.lineItems) {
    if (isSameDay(draftDate, lineItem.treatmentDate)) return true;
  }

  return false;
}

/**
 * Check if amounts match within tolerance.
 * Allows for small rounding differences (0.01 tolerance).
 */
function amountsMatch(amount1: number, amount2: number): boolean {
  return Math.abs(amount1 - amount2) < 0.01;
}

/**
 * Get patient name for a draft claim by traversing illness -> patient.
 */
async function getDraftPatientName(draft: DraftClaim): Promise<string | null> {
  if (!draft.illnessId) return null;

  const illness = await illnessesStorage.get(draft.illnessId);
  if (!illness) return null;

  const patient = await patientsStorage.get(illness.patientId);
  return patient?.name ?? null;
}

// =============================================================================
// CORE MATCHING LOGIC
// =============================================================================

/**
 * Try to find a DIRECT match for a scraped claim.
 * This is the GUARANTEED matching path - uses submissionNumber.
 */
async function findDirectMatch(
  scraped: ScrapedClaim,
  drafts: DraftClaim[]
): Promise<DraftClaimMatch | null> {
  // Strategy 1: Find draft with matching submissionNumber
  if (scraped.submissionNumber) {
    const matchingDraft = drafts.find(
      d => d.submissionNumber === scraped.submissionNumber
    );
    if (matchingDraft) {
      return {
        scrapedClaimId: scraped.id,
        draftClaimId: matchingDraft.id,
        confidence: "exact",
        matchMethod: "submission_number",
        matchDetails: {
          submissionNumberMatch: true,
          scrapedClaimIdMatch: false,
          amountMatch: amountsMatch(matchingDraft.payment.amount, scraped.claimAmount),
          currencyMatch: matchingDraft.payment.currency === scraped.claimCurrency,
          patientMatch: true, // Assumed true for direct match
          treatmentDateMatch: true, // Assumed true for direct match
        },
      };
    }
  }

  // Strategy 2: Find draft with scrapedClaimId reference pointing to this claim
  const matchingDraft = drafts.find(d => d.scrapedClaimId === scraped.id);
  if (matchingDraft) {
    return {
      scrapedClaimId: scraped.id,
      draftClaimId: matchingDraft.id,
      confidence: "exact",
      matchMethod: "scraped_claim_id",
      matchDetails: {
        submissionNumberMatch: false,
        scrapedClaimIdMatch: true,
        amountMatch: amountsMatch(matchingDraft.payment.amount, scraped.claimAmount),
        currencyMatch: matchingDraft.payment.currency === scraped.claimCurrency,
        patientMatch: true,
        treatmentDateMatch: true,
      },
    };
  }

  return null;
}

/**
 * Find HEURISTIC matches for a scraped claim.
 * Used when no direct link exists.
 */
async function findHeuristicMatches(
  scraped: ScrapedClaim,
  drafts: DraftClaim[]
): Promise<DraftClaimMatch[]> {
  const matches: DraftClaimMatch[] = [];

  for (const draft of drafts) {
    // Skip if already linked
    if (draft.scrapedClaimId || draft.submissionNumber) continue;

    const patientName = await getDraftPatientName(draft);
    const draftTreatmentDate = draft.treatmentDate ? new Date(draft.treatmentDate) : null;

    // Core matching criteria
    const amountMatch = amountsMatch(draft.payment.amount, scraped.claimAmount);
    const currencyMatch = draft.payment.currency === scraped.claimCurrency;
    const patientMatch = patientName ? patientNamesMatch(patientName, scraped.memberName) : false;
    const dateMatch = treatmentDatesMatch(draftTreatmentDate, scraped);

    // Determine confidence level
    let confidence: MatchConfidence;
    if (amountMatch && currencyMatch && patientMatch && dateMatch) {
      confidence = "high";
    } else if (amountMatch && currencyMatch && patientMatch) {
      confidence = "medium";
    } else if (amountMatch && currencyMatch) {
      confidence = "low";
    } else {
      // Not enough match criteria
      continue;
    }

    const matchDetails: DraftClaimMatch["matchDetails"] = {
      submissionNumberMatch: false,
      scrapedClaimIdMatch: false,
      amountMatch,
      currencyMatch,
      patientMatch,
      treatmentDateMatch: dateMatch,
      // Debug info
      draftAmount: draft.payment.amount,
      draftCurrency: draft.payment.currency,
      scrapedAmount: scraped.claimAmount,
      scrapedCurrency: scraped.claimCurrency,
      scrapedPatient: scraped.memberName,
      scrapedTreatmentDate: scraped.treatmentDate.toISOString().slice(0, 10),
    };
    if (patientName) matchDetails.draftPatient = patientName;
    if (draftTreatmentDate) matchDetails.draftTreatmentDate = draftTreatmentDate.toISOString().slice(0, 10);

    matches.push({
      scrapedClaimId: scraped.id,
      draftClaimId: draft.id,
      confidence,
      matchMethod: "heuristic",
      matchDetails,
    });
  }

  // Sort by confidence (exact > high > medium > low)
  const confidenceOrder: Record<MatchConfidence, number> = {
    exact: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  matches.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);

  return matches;
}

/**
 * Match a single scraped claim against all eligible draft claims.
 * Returns matches sorted by confidence.
 */
export async function matchScrapedClaimToDrafts(
  scrapedClaim: ScrapedClaim
): Promise<DraftClaimMatch[]> {
  // Get all draft claims that could potentially match:
  // - "accepted" status (ready for submission)
  // - "submitted" status (awaiting confirmation)
  // - NOT archived
  const drafts = await draftClaimsStorage.getAll();
  const eligibleDrafts = drafts.filter(
    d => (d.status === "accepted" || d.status === "submitted") && !d.archivedAt
  );

  // First, try direct match (guaranteed)
  const directMatch = await findDirectMatch(scrapedClaim, eligibleDrafts);
  if (directMatch) {
    return [directMatch];
  }

  // Fall back to heuristic matching
  return findHeuristicMatches(scrapedClaim, eligibleDrafts);
}

/**
 * Match all unmatched scraped claims to draft claims.
 */
export async function matchAllScrapedClaimsToDrafts(): Promise<DraftClaimMatch[]> {
  const allMatches: DraftClaimMatch[] = [];

  const scrapedClaims = await scrapedClaimsStorage.getAll();
  const activeClaims = scrapedClaims.filter(c => !c.archivedAt);

  console.log(`Matching ${activeClaims.length} scraped claims to draft claims...`);

  for (const scraped of activeClaims) {
    const matches = await matchScrapedClaimToDrafts(scraped);

    if (matches.length > 0) {
      const best = matches[0]!;
      console.log(
        `  ${scraped.submissionNumber}: ${matches.length} match(es), ` +
        `best: ${best.confidence} via ${best.matchMethod}`
      );
      allMatches.push(...matches);
    }
  }

  console.log(`Total matches found: ${allMatches.length}`);
  return allMatches;
}

// =============================================================================
// MATCH CONFIRMATION & LINKING
// =============================================================================

/**
 * Confirm a match and create the definitive link.
 * This updates the DraftClaim with the scraped claim reference.
 */
export async function confirmMatch(
  draftClaimId: string,
  scrapedClaimId: string
): Promise<DraftClaim | null> {
  const draft = await draftClaimsStorage.get(draftClaimId);
  if (!draft) return null;

  const scraped = await scrapedClaimsStorage.get(scrapedClaimId);
  if (!scraped) return null;

  // Update draft with the link
  const updated = await updateDraftClaim(draftClaimId, {
    status: "submitted",
    scrapedClaimId: scraped.id,
    submissionNumber: scraped.submissionNumber,
    cignaClaimNumber: scraped.cignaClaimNumber,
    linkedAt: new Date(),
  });

  if (updated) {
    console.log(
      `Linked draft ${draftClaimId} → scraped ${scraped.submissionNumber} (${scrapedClaimId})`
    );
  }

  return updated;
}

/**
 * Store submission number on draft claim after Cigna submission.
 * Call this when the submitter captures the submission number.
 */
export async function linkDraftToSubmissionNumber(
  draftClaimId: string,
  submissionNumber: string
): Promise<DraftClaim | null> {
  const draft = await draftClaimsStorage.get(draftClaimId);
  if (!draft) return null;

  const updated = await updateDraftClaim(draftClaimId, {
    submissionNumber,
    // Don't change status yet - wait for scraped claim to appear
  });

  if (updated) {
    console.log(`Stored submission number ${submissionNumber} on draft ${draftClaimId}`);
  }

  return updated;
}

// =============================================================================
// AUTO-LINKING
// =============================================================================

/**
 * Auto-link any unlinked draft claims that have submission numbers
 * to their corresponding scraped claims.
 *
 * This is the GUARANTEED matching path - runs periodically.
 */
export async function autoLinkBySubmissionNumber(): Promise<number> {
  let linked = 0;

  const drafts = await draftClaimsStorage.getAll();
  const scrapedClaims = await scrapedClaimsStorage.getAll();

  // Build a map of submissionNumber -> ScrapedClaim
  const scrapedBySubmissionNumber = new Map<string, ScrapedClaim>();
  for (const scraped of scrapedClaims) {
    if (scraped.submissionNumber && !scraped.archivedAt) {
      scrapedBySubmissionNumber.set(scraped.submissionNumber, scraped);
    }
  }

  // Find drafts with submission numbers but no scrapedClaimId
  for (const draft of drafts) {
    if (draft.submissionNumber && !draft.scrapedClaimId && !draft.archivedAt) {
      const scraped = scrapedBySubmissionNumber.get(draft.submissionNumber);
      if (scraped) {
        await updateDraftClaim(draft.id, {
          status: "submitted",
          scrapedClaimId: scraped.id,
          cignaClaimNumber: scraped.cignaClaimNumber,
          linkedAt: new Date(),
        });
        console.log(
          `Auto-linked draft ${draft.id} → scraped ${scraped.submissionNumber}`
        );
        linked++;
      }
    }
  }

  return linked;
}

/**
 * Auto-link all HIGH-CONFIDENCE heuristic matches.
 * This links accepted drafts (without submission numbers) to scraped claims
 * when amount + currency + patient + date all match.
 *
 * Returns the number of drafts linked.
 */
export async function autoLinkHighConfidenceMatches(): Promise<number> {
  let linked = 0;

  const allMatches = await matchAllScrapedClaimsToDrafts();

  // Group matches by draft claim (a draft may match multiple scraped claims)
  const matchesByDraft = new Map<string, DraftClaimMatch[]>();
  for (const match of allMatches) {
    // Only consider HIGH confidence heuristic matches
    if (match.confidence !== "high") continue;

    const existing = matchesByDraft.get(match.draftClaimId) ?? [];
    existing.push(match);
    matchesByDraft.set(match.draftClaimId, existing);
  }

  // For each draft with exactly ONE high-confidence match, auto-link it
  for (const [draftId, matches] of matchesByDraft) {
    if (matches.length === 1) {
      const match = matches[0]!;

      // Double-check draft is still accepted and unlinked
      const draft = await draftClaimsStorage.get(draftId);
      if (!draft || draft.status !== "accepted" || draft.scrapedClaimId) {
        continue;
      }

      const result = await confirmMatch(draftId, match.scrapedClaimId);
      if (result) {
        console.log(
          `Auto-linked (high confidence): draft ${draftId} → scraped ${match.scrapedClaimId}`
        );
        linked++;
      }
    } else if (matches.length > 1) {
      console.log(
        `Draft ${draftId} has ${matches.length} high-confidence matches - manual review required`
      );
    }
  }

  return linked;
}

// =============================================================================
// REVIEW API
// =============================================================================

/**
 * Get match candidates for manual review.
 * Returns unlinked scraped claims with their best potential draft matches.
 */
export async function getMatchCandidatesForReview(): Promise<
  Array<{
    scrapedClaim: ScrapedClaim;
    draftClaim: DraftClaim;
    match: DraftClaimMatch;
    patient: Patient | null;
    documents: MedicalDocument[];
  }>
> {
  // First, run auto-linking to catch any guaranteed matches
  await autoLinkBySubmissionNumber();

  const allMatches = await matchAllScrapedClaimsToDrafts();
  const candidates: Array<{
    scrapedClaim: ScrapedClaim;
    draftClaim: DraftClaim;
    match: DraftClaimMatch;
    patient: Patient | null;
    documents: MedicalDocument[];
  }> = [];

  // Group by scraped claim, take best match for each
  const matchesByScrapedClaim = new Map<string, DraftClaimMatch[]>();
  for (const match of allMatches) {
    const existing = matchesByScrapedClaim.get(match.scrapedClaimId) ?? [];
    existing.push(match);
    matchesByScrapedClaim.set(match.scrapedClaimId, existing);
  }

  for (const [scrapedClaimId, matches] of matchesByScrapedClaim) {
    const bestMatch = matches[0]!;

    const scrapedClaim = await scrapedClaimsStorage.get(scrapedClaimId);
    const draftClaim = await draftClaimsStorage.get(bestMatch.draftClaimId);

    if (!scrapedClaim || !draftClaim) continue;

    // Skip if already linked (exact matches that were already confirmed)
    if (draftClaim.scrapedClaimId) continue;

    // Get patient and documents for context
    let patient: Patient | null = null;
    if (draftClaim.illnessId) {
      const illness = await illnessesStorage.get(draftClaim.illnessId);
      if (illness) {
        patient = await patientsStorage.get(illness.patientId);
      }
    }

    const docIds = [
      ...(draftClaim.documentIds ?? []),
      ...(draftClaim.paymentProofDocumentIds ?? []),
    ];
    const documents = (
      await Promise.all(docIds.map(id => documentsStorage.get(id)))
    ).filter((d): d is MedicalDocument => d !== null);

    candidates.push({
      scrapedClaim,
      draftClaim,
      match: bestMatch,
      patient,
      documents,
    });
  }

  return candidates;
}

/**
 * Get all linked (submitted) draft claims with their scraped claim details.
 */
export async function getLinkedDraftClaims(): Promise<
  Array<{
    draftClaim: DraftClaim;
    scrapedClaim: ScrapedClaim | null;
  }>
> {
  const drafts = await draftClaimsStorage.getAll();
  const submittedDrafts = drafts.filter(
    d => d.status === "submitted" && d.scrapedClaimId
  );

  const results: Array<{
    draftClaim: DraftClaim;
    scrapedClaim: ScrapedClaim | null;
  }> = [];

  for (const draft of submittedDrafts) {
    const scraped = draft.scrapedClaimId
      ? await scrapedClaimsStorage.get(draft.scrapedClaimId)
      : null;
    results.push({ draftClaim: draft, scrapedClaim: scraped });
  }

  return results;
}
