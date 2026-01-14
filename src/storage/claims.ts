/**
 * Scraped Claims Storage
 *
 * JSON file storage for claims scraped from Cigna Envoy portal.
 */

import type {
  ScrapedClaim,
  CreateScrapedClaimInput,
} from "../types/scraped-claim.js";
import {
  createStorage,
  STORAGE_DIRS,
  generateId,
  dateReviver,
} from "./base.js";

/**
 * Storage operations for scraped claims.
 */
export const claimsStorage = createStorage<ScrapedClaim>(
  STORAGE_DIRS.claims,
  dateReviver
);

/**
 * Create a new scraped claim record.
 */
export async function createScrapedClaim(
  input: CreateScrapedClaimInput
): Promise<ScrapedClaim> {
  const claim: ScrapedClaim = {
    ...input,
    id: generateId(),
    scrapedAt: new Date(),
  };
  return claimsStorage.save(claim);
}

/**
 * Update an existing scraped claim.
 */
export async function updateScrapedClaim(
  id: string,
  updates: Partial<Omit<ScrapedClaim, "id">>
): Promise<ScrapedClaim | null> {
  const existing = await claimsStorage.get(id);
  if (!existing) return null;

  const updated: ScrapedClaim = {
    ...existing,
    ...updates,
  };
  return claimsStorage.save(updated);
}

/**
 * Find claims by Cigna claim number.
 */
export async function findClaimByCignaNumber(
  cignaClaimNumber: string
): Promise<ScrapedClaim | null> {
  const claims = await claimsStorage.find(
    (c) => c.cignaClaimNumber === cignaClaimNumber
  );
  return claims[0] ?? null;
}

/**
 * Find claims by submission number.
 */
export async function findClaimBySubmissionNumber(
  submissionNumber: string
): Promise<ScrapedClaim | null> {
  const claims = await claimsStorage.find(
    (c) => c.submissionNumber === submissionNumber
  );
  return claims[0] ?? null;
}

/**
 * Get claims by status.
 */
export async function getClaimsByStatus(
  status: ScrapedClaim["status"]
): Promise<ScrapedClaim[]> {
  return claimsStorage.find((c) => c.status === status);
}

/**
 * Get claims within a date range.
 */
export async function getClaimsByDateRange(
  startDate: Date,
  endDate: Date
): Promise<ScrapedClaim[]> {
  return claimsStorage.find((c) => {
    const treatmentDate = new Date(c.treatmentDate);
    return treatmentDate >= startDate && treatmentDate <= endDate;
  });
}

/**
 * Get claims by member name.
 */
export async function getClaimsByMember(
  memberName: string
): Promise<ScrapedClaim[]> {
  const normalizedName = memberName.toLowerCase();
  return claimsStorage.find((c) =>
    c.memberName.toLowerCase().includes(normalizedName)
  );
}

/**
 * Get total claim amount across all claims.
 */
export async function getTotalClaimAmount(): Promise<{
  total: number;
  currency: string;
  count: number;
}> {
  const claims = await claimsStorage.getAll();

  // Group by currency
  const byCurrency = new Map<string, number>();
  for (const claim of claims) {
    const current = byCurrency.get(claim.claimCurrency) ?? 0;
    byCurrency.set(claim.claimCurrency, current + claim.claimAmount);
  }

  // Return the most common currency total
  let maxCurrency = "EUR";
  let maxTotal = 0;

  for (const [currency, total] of byCurrency) {
    if (total > maxTotal) {
      maxTotal = total;
      maxCurrency = currency;
    }
  }

  return {
    total: maxTotal,
    currency: maxCurrency,
    count: claims.length,
  };
}
