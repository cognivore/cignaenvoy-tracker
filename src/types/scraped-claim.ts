/**
 * Scraped claim types.
 * Claims imported from Cigna Envoy portal via Selenium scraping.
 */

/**
 * Status of a scraped claim as shown in Cigna Envoy portal.
 */
export type ScrapedClaimStatus = "processed" | "pending" | "rejected";

/** All scraped claim statuses */
export const SCRAPED_CLAIM_STATUSES: readonly ScrapedClaimStatus[] = [
  "processed",
  "pending",
  "rejected",
] as const;

/**
 * Line item within a scraped claim.
 * Represents individual treatments within a claim submission.
 */
export interface ScrapedLineItem {
  /** Treatment description (e.g., "INDIVIDUAL PSYCHOTHERAPY") */
  treatmentDescription: string;

  /** Treatment date */
  treatmentDate: Date;

  /** Claim amount in original currency */
  claimAmount: number;

  /** Original currency (e.g., "EUR") */
  claimCurrency: string;

  /** Converted amount (e.g., to GBP) */
  convertedAmount?: number;

  /** Converted currency (e.g., "GBP") */
  convertedCurrency?: string;

  /** Exchange rate used for conversion */
  exchangeRate?: number;

  /** Currency date for exchange rate */
  currencyDate?: Date;

  /** Amount paid for this line item */
  amountPaid?: number;

  /** Currency of payment */
  paymentCurrency?: string;

  /** Status of this line item */
  status: ScrapedClaimStatus;
}

/**
 * Scraped claim from Cigna Envoy portal.
 * Contains all data extracted from the claims summary and detail pages.
 */
export interface ScrapedClaim {
  /** Internal UUID for local tracking */
  id: string;

  /** Cigna claim number (e.g., "82143450") */
  cignaClaimNumber: string;

  /** Submission number (e.g., "36141816") */
  submissionNumber: string;

  /** Member name as shown in portal */
  memberName: string;

  /** Primary treatment date */
  treatmentDate: Date;

  /** Total claim amount in original currency */
  claimAmount: number;

  /** Original currency of claim */
  claimCurrency: string;

  /** Converted total amount */
  convertedAmount?: number;

  /** Converted currency */
  convertedCurrency?: string;

  /** Exchange rate used */
  exchangeRate?: number;

  /** Total amount paid */
  amountPaid?: number;

  /** Currency of payment */
  paymentCurrency?: string;

  /** Overall claim status */
  status: ScrapedClaimStatus;

  /** Date claim was submitted to Cigna */
  submissionDate: Date;

  /** Payment date if paid */
  paymentDate?: Date;

  /** Individual line items within this claim */
  lineItems: ScrapedLineItem[];

  /** Timestamp when this claim was scraped */
  scrapedAt: Date;

  /** Timestamp when this claim was archived (if archived) */
  archivedAt?: Date;
}

/**
 * Input for creating a scraped claim record.
 */
export type CreateScrapedClaimInput = Omit<ScrapedClaim, "id" | "scrapedAt">;
