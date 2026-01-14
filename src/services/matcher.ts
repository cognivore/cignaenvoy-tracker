/**
 * Matching Engine
 *
 * Matches medical documents to scraped claims based on amounts,
 * dates, and other criteria.
 */

import type { ScrapedClaim } from "../types/scraped-claim.js";
import type { MedicalDocument, DetectedAmount } from "../types/medical-document.js";
import type {
  DocumentClaimAssignment,
  CreateAssignmentInput,
  MatchReasonType,
} from "../types/assignment.js";
import { MATCH_THRESHOLDS } from "../types/assignment.js";
import { claimsStorage } from "../storage/claims.js";
import { documentsStorage, getMedicalBills } from "../storage/documents.js";
import {
  createAssignment,
  getAssignmentByPair,
  clearCandidatesForDocument,
} from "../storage/assignments.js";
import { ensureStorageDirs } from "../storage/index.js";

/**
 * Match result from comparing a document to a claim.
 */
interface MatchResult {
  claimId: string;
  documentId: string;
  score: number;
  reasons: MatchReason[];
  amountMatchDetails: {
    documentAmount: number;
    documentCurrency: string;
    claimAmount: number;
    claimCurrency: string;
    difference: number;
    differencePercent: number;
  } | undefined;
  dateMatchDetails: {
    documentDate: Date;
    claimDate: Date;
    daysDifference: number;
  } | undefined;
}

/**
 * Individual match reason.
 */
interface MatchReason {
  type: MatchReasonType;
  score: number;
  description: string;
}

/**
 * Compare two amounts with currency conversion consideration.
 * Returns difference percentage (0 = exact match).
 */
function compareAmounts(
  docAmount: number,
  docCurrency: string,
  claimAmount: number,
  claimCurrency: string
): { difference: number; differencePercent: number } {
  // For now, only compare same currency
  // TODO: Add currency conversion rates
  if (docCurrency !== claimCurrency) {
    return { difference: Infinity, differencePercent: Infinity };
  }

  const difference = Math.abs(docAmount - claimAmount);
  const differencePercent = claimAmount > 0 ? difference / claimAmount : 1;

  return { difference, differencePercent };
}

/**
 * Calculate days between two dates.
 */
function daysBetween(date1: Date, date2: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const d1 = new Date(date1).getTime();
  const d2 = new Date(date2).getTime();
  return Math.abs(Math.floor((d2 - d1) / MS_PER_DAY));
}

/**
 * Find the best matching amount from document for a claim.
 */
function findBestAmountMatch(
  detectedAmounts: DetectedAmount[],
  claimAmount: number,
  claimCurrency: string
): DetectedAmount | null {
  let bestMatch: DetectedAmount | null = null;
  let bestDiff = Infinity;

  for (const amount of detectedAmounts) {
    const { differencePercent } = compareAmounts(
      amount.value,
      amount.currency,
      claimAmount,
      claimCurrency
    );

    if (differencePercent < bestDiff) {
      bestDiff = differencePercent;
      bestMatch = amount;
    }
  }

  return bestMatch;
}

/**
 * Calculate match score between a document and a claim.
 */
function calculateMatchScore(
  document: MedicalDocument,
  claim: ScrapedClaim
): MatchResult | null {
  const reasons: MatchReason[] = [];
  let totalScore = 0;

  // Find best amount match
  const bestAmount = findBestAmountMatch(
    document.detectedAmounts,
    claim.claimAmount,
    claim.claimCurrency
  );

  let amountMatchDetails: MatchResult["amountMatchDetails"];

  if (bestAmount) {
    const { difference, differencePercent } = compareAmounts(
      bestAmount.value,
      bestAmount.currency,
      claim.claimAmount,
      claim.claimCurrency
    );

    amountMatchDetails = {
      documentAmount: bestAmount.value,
      documentCurrency: bestAmount.currency,
      claimAmount: claim.claimAmount,
      claimCurrency: claim.claimCurrency,
      difference,
      differencePercent,
    };

    if (differencePercent <= MATCH_THRESHOLDS.EXACT_AMOUNT_TOLERANCE) {
      reasons.push({
        type: "exact_amount",
        score: MATCH_THRESHOLDS.EXACT_AMOUNT_SCORE,
        description: `Exact amount match: ${bestAmount.currency} ${bestAmount.value.toFixed(2)} matches claim ${claim.claimCurrency} ${claim.claimAmount.toFixed(2)}`,
      });
      totalScore += MATCH_THRESHOLDS.EXACT_AMOUNT_SCORE;
    } else if (differencePercent <= MATCH_THRESHOLDS.APPROXIMATE_AMOUNT_TOLERANCE) {
      reasons.push({
        type: "approximate_amount",
        score: MATCH_THRESHOLDS.APPROXIMATE_AMOUNT_SCORE,
        description: `Approximate amount match: ${bestAmount.currency} ${bestAmount.value.toFixed(2)} ≈ claim ${claim.claimCurrency} ${claim.claimAmount.toFixed(2)} (${(differencePercent * 100).toFixed(1)}% diff)`,
      });
      totalScore += MATCH_THRESHOLDS.APPROXIMATE_AMOUNT_SCORE;
    }

    // Also check against line items
    for (const lineItem of claim.lineItems) {
      const lineMatch = findBestAmountMatch(
        document.detectedAmounts,
        lineItem.claimAmount,
        lineItem.claimCurrency
      );

      if (lineMatch) {
        const lineDiff = compareAmounts(
          lineMatch.value,
          lineMatch.currency,
          lineItem.claimAmount,
          lineItem.claimCurrency
        );

        if (lineDiff.differencePercent <= MATCH_THRESHOLDS.EXACT_AMOUNT_TOLERANCE) {
          reasons.push({
            type: "exact_amount",
            score: MATCH_THRESHOLDS.EXACT_AMOUNT_SCORE * 0.5, // Line item match worth less
            description: `Line item match: ${lineMatch.currency} ${lineMatch.value.toFixed(2)} matches "${lineItem.treatmentDescription}"`,
          });
          totalScore += MATCH_THRESHOLDS.EXACT_AMOUNT_SCORE * 0.5;
          break; // Only count once
        }
      }
    }
  }

  // Date proximity check
  let dateMatchDetails: MatchResult["dateMatchDetails"];

  if (document.date) {
    const daysDiff = daysBetween(document.date, claim.treatmentDate);

    dateMatchDetails = {
      documentDate: document.date,
      claimDate: claim.treatmentDate,
      daysDifference: daysDiff,
    };

    if (daysDiff <= MATCH_THRESHOLDS.DATE_PROXIMITY_DAYS) {
      const proximityScore =
        MATCH_THRESHOLDS.DATE_PROXIMITY_BONUS *
        (1 - daysDiff / MATCH_THRESHOLDS.DATE_PROXIMITY_DAYS);

      reasons.push({
        type: "date_proximity",
        score: proximityScore,
        description: `Date proximity: document ${document.date.toISOString().split("T")[0]} is ${daysDiff} days from treatment ${claim.treatmentDate.toISOString().split("T")[0]}`,
      });
      totalScore += proximityScore;
    }
  }

  // Provider name match (check if medical keywords match treatment description)
  const claimDescription = claim.lineItems
    .map((li) => li.treatmentDescription)
    .join(" ")
    .toLowerCase();

  for (const keyword of document.medicalKeywords) {
    if (claimDescription.includes(keyword.toLowerCase())) {
      reasons.push({
        type: "provider_match",
        score: MATCH_THRESHOLDS.PROVIDER_MATCH_BONUS,
        description: `Keyword match: "${keyword}" found in claim description`,
      });
      totalScore += MATCH_THRESHOLDS.PROVIDER_MATCH_BONUS;
      break; // Only count once
    }
  }

  // Return null if score is too low
  if (totalScore < MATCH_THRESHOLDS.MINIMUM_CANDIDATE_SCORE) {
    return null;
  }

  // Cap score at 100
  totalScore = Math.min(100, totalScore);

  return {
    claimId: claim.id,
    documentId: document.id,
    score: totalScore,
    reasons,
    amountMatchDetails,
    dateMatchDetails,
  };
}

/**
 * Matching engine configuration.
 */
export interface MatcherConfig {
  /** Minimum score to create a candidate assignment */
  minScore?: number;
  /** Maximum candidates per document */
  maxCandidatesPerDocument?: number;
  /** Clear existing candidates before re-matching */
  clearExisting?: boolean;
}

/**
 * Document-claim matching engine.
 */
export class Matcher {
  private config: MatcherConfig;

  constructor(config: MatcherConfig = {}) {
    this.config = {
      minScore: config.minScore ?? MATCH_THRESHOLDS.MINIMUM_CANDIDATE_SCORE,
      maxCandidatesPerDocument: config.maxCandidatesPerDocument ?? 5,
      clearExisting: config.clearExisting ?? true,
    };

    ensureStorageDirs();
  }

  /**
   * Match a single document against all claims.
   */
  async matchDocument(
    document: MedicalDocument
  ): Promise<DocumentClaimAssignment[]> {
    const assignments: DocumentClaimAssignment[] = [];

    // Only process documents with detected amounts
    if (document.detectedAmounts.length === 0) {
      return assignments;
    }

    // Get all claims
    const claims = await claimsStorage.getAll();

    // Calculate match scores
    const matches: MatchResult[] = [];

    for (const claim of claims) {
      const match = calculateMatchScore(document, claim);
      if (match && match.score >= (this.config.minScore ?? 0)) {
        matches.push(match);
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    // Take top candidates
    const topMatches = matches.slice(0, this.config.maxCandidatesPerDocument);

    // Clear existing candidates if configured
    if (this.config.clearExisting) {
      await clearCandidatesForDocument(document.id);
    }

    // Create assignments
    for (const match of topMatches) {
      // Check if assignment already exists
      const existing = await getAssignmentByPair(match.documentId, match.claimId);
      if (existing) {
        assignments.push(existing);
        continue;
      }

      const input: CreateAssignmentInput = {
        documentId: match.documentId,
        claimId: match.claimId,
        matchScore: match.score,
        matchReasonType: match.reasons[0]?.type ?? "approximate_amount",
        matchReason: match.reasons.map((r) => r.description).join("; "),
        ...(match.amountMatchDetails && { amountMatchDetails: match.amountMatchDetails }),
        ...(match.dateMatchDetails && { dateMatchDetails: match.dateMatchDetails }),
      };

      const assignment = await createAssignment(input);
      assignments.push(assignment);
    }

    return assignments;
  }

  /**
   * Match all medical bills against all claims.
   */
  async matchAllDocuments(): Promise<DocumentClaimAssignment[]> {
    const allAssignments: DocumentClaimAssignment[] = [];

    // Get all medical bills (documents with amounts)
    const documents = await getMedicalBills();

    console.log(`Matching ${documents.length} medical bills against claims...`);

    for (const document of documents) {
      const assignments = await this.matchDocument(document);
      allAssignments.push(...assignments);
    }

    console.log(`Created ${allAssignments.length} match candidates`);

    return allAssignments;
  }

  /**
   * Match a specific document by ID.
   */
  async matchDocumentById(documentId: string): Promise<DocumentClaimAssignment[]> {
    const document = await documentsStorage.get(documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    return this.matchDocument(document);
  }

  /**
   * Re-match all documents (clears existing candidates).
   */
  async rematchAll(): Promise<DocumentClaimAssignment[]> {
    return this.matchAllDocuments();
  }

  /**
   * Get match statistics.
   */
  async getMatchStats(): Promise<{
    totalDocuments: number;
    documentsWithAmounts: number;
    totalClaims: number;
    matchesCreated: number;
    avgMatchScore: number;
    matchesByScore: Record<string, number>;
  }> {
    const documents = await documentsStorage.getAll();
    const claims = await claimsStorage.getAll();
    const documentsWithAmounts = documents.filter(
      (d) => d.detectedAmounts.length > 0
    ).length;

    // Run matching to get stats (won't create duplicates)
    const matches = await this.matchAllDocuments();

    const matchesByScore: Record<string, number> = {
      "90-100": 0,
      "80-89": 0,
      "70-79": 0,
      "60-69": 0,
      "50-59": 0,
    };

    let totalScore = 0;
    for (const match of matches) {
      totalScore += match.matchScore;

      if (match.matchScore >= 90) matchesByScore["90-100"]!++;
      else if (match.matchScore >= 80) matchesByScore["80-89"]!++;
      else if (match.matchScore >= 70) matchesByScore["70-79"]!++;
      else if (match.matchScore >= 60) matchesByScore["60-69"]!++;
      else matchesByScore["50-59"]!++;
    }

    return {
      totalDocuments: documents.length,
      documentsWithAmounts,
      totalClaims: claims.length,
      matchesCreated: matches.length,
      avgMatchScore: matches.length > 0 ? totalScore / matches.length : 0,
      matchesByScore,
    };
  }
}

/**
 * Create a matcher with default configuration.
 */
export function createMatcher(config?: MatcherConfig): Matcher {
  return new Matcher(config);
}

/**
 * Manual match - create an assignment manually.
 */
export async function createManualAssignment(
  documentId: string,
  claimId: string,
  reviewNotes?: string
): Promise<DocumentClaimAssignment> {
  // Verify document exists
  const document = await documentsStorage.get(documentId);
  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  // Verify claim exists
  const claim = await claimsStorage.get(claimId);
  if (!claim) {
    throw new Error(`Claim not found: ${claimId}`);
  }

  // Check if assignment already exists
  const existing = await getAssignmentByPair(documentId, claimId);
  if (existing) {
    return existing;
  }

  const input: CreateAssignmentInput = {
    documentId,
    claimId,
    matchScore: 100, // Manual matches are full confidence
    matchReasonType: "manual",
    matchReason: reviewNotes ?? "Manually assigned by user",
  };

  return createAssignment(input);
}
