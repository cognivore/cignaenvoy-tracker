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

  // Calendar events don't have amounts, so we use different scoring
  const isCalendarEvent = document.sourceType === "calendar";

  // Find best amount match (skip for calendar events)
  const bestAmount = isCalendarEvent
    ? null
    : findBestAmountMatch(
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
  // Check against all treatment dates (primary + line items) to find best match
  let dateMatchDetails: MatchResult["dateMatchDetails"];
  const documentDate = document.date ?? document.calendarStart;

  if (documentDate) {
    // Check primary treatment date
    let bestDaysDiff = daysBetween(documentDate, claim.treatmentDate);
    let bestMatchDate = claim.treatmentDate;

    // Also check line item dates for ALL documents (not just calendar events)
    // This ensures we find the closest treatment date
    for (const lineItem of claim.lineItems) {
      const lineItemDaysDiff = daysBetween(documentDate, lineItem.treatmentDate);
      if (lineItemDaysDiff < bestDaysDiff) {
        bestDaysDiff = lineItemDaysDiff;
        bestMatchDate = lineItem.treatmentDate;
      }
    }

    dateMatchDetails = {
      documentDate,
      claimDate: bestMatchDate,
      daysDifference: bestDaysDiff,
    };

    // CRITICAL: Reject matches where dates are too far apart
    // This prevents matching documents from completely wrong time periods
    if (bestDaysDiff > MATCH_THRESHOLDS.MAX_DATE_MISMATCH_DAYS) {
      // Date mismatch is too severe - no match possible
      return null;
    }

    // Apply penalty for moderate date mismatches
    if (bestDaysDiff > MATCH_THRESHOLDS.DATE_MISMATCH_PENALTY_THRESHOLD) {
      const penalty = MATCH_THRESHOLDS.DATE_MISMATCH_PENALTY;
      totalScore -= penalty;
      reasons.push({
        type: "date_proximity",
        score: -penalty,
        description: `Date mismatch penalty: document ${documentDate.toISOString().split("T")[0]} is ${bestDaysDiff} days from nearest treatment ${bestMatchDate.toISOString().split("T")[0]}`,
      });
    } else if (bestDaysDiff <= MATCH_THRESHOLDS.DATE_PROXIMITY_DAYS) {
      // Calendar events get higher date proximity bonus (primary match criterion)
      const baseBonus = isCalendarEvent
        ? MATCH_THRESHOLDS.EXACT_AMOUNT_SCORE // Same as exact amount for calendar events
        : MATCH_THRESHOLDS.DATE_PROXIMITY_BONUS;

      // Exact date match for calendar events is very strong
      const dateScore =
        bestDaysDiff === 0 && isCalendarEvent
          ? baseBonus
          : baseBonus * (1 - bestDaysDiff / MATCH_THRESHOLDS.DATE_PROXIMITY_DAYS);

      reasons.push({
        type: "date_proximity",
        score: dateScore,
        description: isCalendarEvent
          ? `Calendar event on ${documentDate.toISOString().split("T")[0]} ${bestDaysDiff === 0 ? "matches" : "near"} treatment ${bestMatchDate.toISOString().split("T")[0]} (${bestDaysDiff} days diff)`
          : `Date proximity: document ${documentDate.toISOString().split("T")[0]} is ${bestDaysDiff} days from treatment ${bestMatchDate.toISOString().split("T")[0]}`,
      });
      totalScore += dateScore;
    }
  } else {
    // No date on document - apply a penalty since we can't verify temporal relevance
    const penalty = MATCH_THRESHOLDS.DATE_MISMATCH_PENALTY / 2;
    totalScore -= penalty;
    reasons.push({
      type: "date_proximity",
      score: -penalty,
      description: "No date found on document - temporal relevance uncertain",
    });
  }

  // Provider name match (check if medical keywords match treatment description)
  const claimDescription = claim.lineItems
    .map((li) => li.treatmentDescription)
    .join(" ")
    .toLowerCase();

  // For calendar events, also check summary and location
  const searchableText = isCalendarEvent
    ? [
      ...document.medicalKeywords,
      document.calendarSummary,
      document.calendarLocation,
    ].filter(Boolean)
    : document.medicalKeywords;

  for (const keyword of searchableText) {
    if (keyword && claimDescription.includes(keyword.toLowerCase())) {
      // Calendar event location/summary matches are worth more
      const keywordScore = isCalendarEvent
        ? MATCH_THRESHOLDS.PROVIDER_MATCH_BONUS * 2
        : MATCH_THRESHOLDS.PROVIDER_MATCH_BONUS;

      reasons.push({
        type: "provider_match",
        score: keywordScore,
        description: isCalendarEvent
          ? `Calendar event "${document.calendarSummary}" matches treatment description`
          : `Keyword match: "${keyword}" found in claim description`,
      });
      totalScore += keywordScore;
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

    // Check if document is matchable:
    // - Has detected amounts (for bills)
    // - OR is a calendar event with a date
    const isCalendarEvent = document.sourceType === "calendar";
    const hasDate = document.date || document.calendarStart;

    if (document.detectedAmounts.length === 0 && !(isCalendarEvent && hasDate)) {
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
   * Match all matchable documents against all claims.
   * Includes medical bills (with amounts) and calendar events (with dates).
   */
  async matchAllDocuments(): Promise<DocumentClaimAssignment[]> {
    const allAssignments: DocumentClaimAssignment[] = [];

    // Get all documents
    const allDocuments = await documentsStorage.getAll();

    // Filter to matchable documents:
    // - Medical bills with amounts
    // - Calendar events (appointments) with dates
    const matchableDocuments = allDocuments.filter(
      (d) =>
        (d.classification === "medical_bill" && d.detectedAmounts.length > 0) ||
        (d.sourceType === "calendar" && (d.date || d.calendarStart))
    );

    console.log(
      `Matching ${matchableDocuments.length} documents against claims ` +
      `(${matchableDocuments.filter((d) => d.sourceType === "calendar").length} calendar events)...`
    );

    for (const document of matchableDocuments) {
      const assignments = await this.matchDocument(document);
      allAssignments.push(...assignments);
    }

    console.log(`Created ${allAssignments.length} match candidates`);

    return allAssignments;
  }

  /**
   * Match a set of documents (by object).
   */
  async matchDocuments(
    documents: MedicalDocument[]
  ): Promise<DocumentClaimAssignment[]> {
    const uniqueDocuments = Array.from(
      new Map(documents.map((document) => [document.id, document])).values()
    );

    const assignments: DocumentClaimAssignment[] = [];
    for (const document of uniqueDocuments) {
      const matches = await this.matchDocument(document);
      assignments.push(...matches);
    }

    return assignments;
  }

  /**
   * Match a set of documents by ID.
   */
  async matchDocumentsByIds(
    documentIds: string[]
  ): Promise<DocumentClaimAssignment[]> {
    const uniqueIds = Array.from(new Set(documentIds));
    const documents = await Promise.all(
      uniqueIds.map((id) => documentsStorage.get(id))
    );

    const existingDocuments = documents.filter(
      (doc): doc is MedicalDocument => !!doc
    );

    return this.matchDocuments(existingDocuments);
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
