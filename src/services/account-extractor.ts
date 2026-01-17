/**
 * Account Extractor Service
 *
 * Extracts relevant email addresses/accounts from medical documents
 * to be stored with illness records.
 */

import type { MedicalDocument } from "../types/medical-document.js";
import type { RelevantAccount, AccountRole } from "../types/illness.js";

/**
 * Domains that are typically associated with providers.
 */
const PROVIDER_DOMAIN_PATTERNS = [
  /hospital/i,
  /clinic/i,
  /medical/i,
  /health/i,
  /care/i,
  /doctor/i,
  /dr\./i,
  /nhs/i,
  /therapy/i,
  /psycho/i,
  /dentist/i,
  /dental/i,
  /ortho/i,
  /physio/i,
  /chiro/i,
  /optic/i,
  /eye/i,
  /vision/i,
];

/**
 * Domains that are typically pharmacies.
 */
const PHARMACY_DOMAIN_PATTERNS = [
  /pharmacy/i,
  /apothecary/i,
  /apotheke/i,
  /farmacia/i,
  /rx/i,
  /drug/i,
  /med(s|ication)?store/i,
  /walgreen/i,
  /cvs/i,
  /boots/i,
];

/**
 * Domains that are typically labs.
 */
const LAB_DOMAIN_PATTERNS = [
  /lab/i,
  /laboratory/i,
  /diagnostic/i,
  /pathology/i,
  /test/i,
  /analysis/i,
  /quest/i,
  /labcorp/i,
];

/**
 * Domains that are typically insurance-related.
 */
const INSURANCE_DOMAIN_PATTERNS = [
  /insurance/i,
  /cigna/i,
  /aetna/i,
  /anthem/i,
  /united.*health/i,
  /humana/i,
  /kaiser/i,
  /blue.*cross/i,
  /blue.*shield/i,
  /assurance/i,
  /versicherung/i,
];

/**
 * Infer the role of an account based on email domain and name.
 */
function inferRole(email: string, name?: string): AccountRole {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const combinedText = `${domain} ${name ?? ""}`.toLowerCase();

  // Check patterns in order of specificity
  if (PHARMACY_DOMAIN_PATTERNS.some((p) => p.test(combinedText))) {
    return "pharmacy";
  }

  if (LAB_DOMAIN_PATTERNS.some((p) => p.test(combinedText))) {
    return "lab";
  }

  if (INSURANCE_DOMAIN_PATTERNS.some((p) => p.test(combinedText))) {
    return "insurance";
  }

  if (PROVIDER_DOMAIN_PATTERNS.some((p) => p.test(combinedText))) {
    return "provider";
  }

  return "other";
}

/**
 * Common personal email domains to exclude from relevant accounts.
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "inbox.com",
  "zoho.com",
  "yandex.com",
  "gmx.com",
  "gmx.de",
  "web.de",
  "t-online.de",
  "freenet.de",
]);

/**
 * Check if an email is likely a personal email address.
 */
function isPersonalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return PERSONAL_EMAIL_DOMAINS.has(domain);
}

/**
 * Normalize email address for deduplication.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Extract relevant accounts from a medical document.
 *
 * Extracts email addresses from:
 * - Email sender (fromAddress)
 * - Calendar event organizer
 * - Calendar event attendees (excluding personal emails)
 *
 * @param document - The medical document to extract accounts from
 * @returns Array of extracted accounts with inferred roles
 */
export function extractRelevantAccounts(
  document: MedicalDocument
): Omit<RelevantAccount, "addedAt" | "sourceDocumentId">[] {
  const accounts: Map<string, Omit<RelevantAccount, "addedAt" | "sourceDocumentId">> = new Map();

  // Helper to add account if not personal email
  const addAccount = (email: string, name?: string) => {
    const normalized = normalizeEmail(email);

    // Skip empty or invalid emails
    if (!normalized || !normalized.includes("@")) {
      return;
    }

    // Skip personal email addresses
    if (isPersonalEmail(normalized)) {
      return;
    }

    // Skip if already added
    if (accounts.has(normalized)) {
      return;
    }

    const trimmedName = name?.trim();
    accounts.set(normalized, {
      email: normalized,
      ...(trimmedName && { name: trimmedName }),
      role: inferRole(normalized, name),
    });
  };

  // Extract from email sender
  if (document.sourceType === "email" || document.sourceType === "attachment") {
    if (document.fromAddress) {
      // Parse "Name <email@domain.com>" format
      const fromMatch = document.fromAddress.match(/^(.+?)\s*<(.+)>$/);
      if (fromMatch) {
        addAccount(fromMatch[2]!, fromMatch[1]!.trim());
      } else {
        addAccount(document.fromAddress);
      }
    }
  }

  // Extract from calendar event organizer
  if (document.sourceType === "calendar" && document.calendarOrganizer) {
    if (document.calendarOrganizer.email) {
      addAccount(
        document.calendarOrganizer.email,
        document.calendarOrganizer.displayName
      );
    }
  }

  // Extract from calendar event attendees
  if (document.sourceType === "calendar" && document.calendarAttendees) {
    for (const attendee of document.calendarAttendees) {
      // Skip organizer (already added) and skip declined attendees
      if (attendee.organizer) continue;
      if (attendee.response === "declined") continue;

      addAccount(attendee.email, attendee.name);
    }
  }

  return Array.from(accounts.values());
}

/**
 * Extract relevant accounts and prepare them for storage.
 * Adds timestamp and source document ID.
 */
export function extractAndPrepareAccounts(
  document: MedicalDocument
): RelevantAccount[] {
  const extracted = extractRelevantAccounts(document);
  const now = new Date();

  return extracted.map((account) => ({
    ...account,
    addedAt: now,
    sourceDocumentId: document.id,
  }));
}
