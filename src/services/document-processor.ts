/**
 * Document Processor Service
 *
 * Processes email/attachment/calendar dumps using QweN OCR API
 * to extract and classify medical documents.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import {
  QwenClient,
  qwenClient,
  canOcr,
  type EmailSearchResult,
  type EmailAttachment,
  type EmailFTSSearchResponse,
  type CalendarEventSearchResult,
} from "./qwen-client.js";
import type {
  MedicalDocument,
  CreateMedicalDocumentInput,
  DocumentClassification,
  DetectedAmount,
  CalendarAttendee,
} from "../types/medical-document.js";
import { MEDICAL_KEYWORDS } from "../types/medical-document.js";
import {
  createMedicalDocument,
  findDocumentByEmailId,
  findDocumentByAttachmentPath,
  findDocumentByCalendarEventId,
} from "../storage/documents.js";
import { ensureStorageDirs } from "../storage/index.js";

/**
 * Amount extraction patterns.
 * Matches various currency formats.
 */
const AMOUNT_PATTERNS = [
  // EUR 80.00, USD 160.00, GBP 145.07 (decimal optional)
  /\b(EUR|USD|GBP|CHF|CAD|AUD)\s*([0-9]{1,3}(?:[,.]?[0-9]{3})*(?:[.,][0-9]{2})?)\b/gi,
  // €80.00, $160.00, £145.07 (decimal optional)
  /([€$£])\s*([0-9]{1,3}(?:[,.]?[0-9]{3})*(?:[.,][0-9]{2})?)\b/g,
  // 80.00 EUR, 160.00 USD (decimal optional)
  /\b([0-9]{1,3}(?:[,.]?[0-9]{3})*(?:[.,][0-9]{2})?)\s*(EUR|USD|GBP|CHF|CAD|AUD)\b/gi,
  // 160 € or 80 € (whole number with currency symbol after - European format)
  // Note: no trailing \b since € is not a word char
  /\b([0-9]{1,3}(?:[,.]?[0-9]{3})*)\s*([€$£])(?![0-9])/g,
  // Generic amounts with context (Total: 80.00)
  /(?:total|amount|sum|fee|charge|cost|price|bill)[:\s]*([0-9]{1,3}(?:[,.]?[0-9]{3})*(?:[.,][0-9]{2})?)/gi,
];

/**
 * Currency symbol to code mapping.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  "€": "EUR",
  "$": "USD",
  "£": "GBP",
};

/**
 * Extract amounts from text.
 */
function extractAmounts(text: string): DetectedAmount[] {
  const amounts: DetectedAmount[] = [];
  const seen = new Set<string>();

  for (const pattern of AMOUNT_PATTERNS) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let value: number;
      let currency: string;
      let rawText = match[0];

      if (match[1] && CURRENCY_SYMBOLS[match[1]]) {
        // Symbol format (€80.00)
        currency = CURRENCY_SYMBOLS[match[1]]!;
        value = parseFloat(match[2]!.replace(",", ""));
      } else if (match[2] && CURRENCY_SYMBOLS[match[2]]) {
        // European format: number then symbol (160 €)
        currency = CURRENCY_SYMBOLS[match[2]]!;
        value = parseFloat(match[1]!.replace(",", ""));
      } else if (match[1] && match[1].match(/[A-Z]{3}/)) {
        // Currency code first (EUR 80.00)
        currency = match[1].toUpperCase();
        value = parseFloat(match[2]!.replace(",", ""));
      } else if (match[2] && match[2].match(/[A-Z]{3}/i)) {
        // Currency code last (80.00 EUR)
        currency = match[2].toUpperCase();
        value = parseFloat(match[1]!.replace(",", ""));
      } else {
        // Generic amount without currency
        currency = "EUR"; // Default
        value = parseFloat(match[1]!.replace(",", ""));
      }

      // Deduplicate
      const key = `${value}-${currency}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Get context (surrounding text)
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + match[0].length + 50);
      const context = text.slice(start, end).replace(/\s+/g, " ").trim();

      amounts.push({
        value,
        currency,
        rawText,
        context,
        confidence: currency !== "EUR" ? 90 : 70, // Higher confidence if currency is explicit
      });
    }
  }

  // Sort by value descending
  return amounts.sort((a, b) => b.value - a.value);
}

/**
 * Classify document based on content.
 */
function classifyDocument(
  text: string,
  subject?: string,
  isCalendarEvent: boolean = false
): DocumentClassification {
  // Calendar events are appointments by default
  if (isCalendarEvent) {
    return "appointment";
  }

  const combined = `${subject ?? ""} ${text}`.toLowerCase();

  // Check for specific document types
  const classifications: Array<{
    type: DocumentClassification;
    keywords: string[];
    score: number;
  }> = [
    {
      type: "medical_bill",
      keywords: [
        "invoice",
        "bill",
        "rechnung",
        "facture",
        "amount due",
        "total due",
        "payment due",
        "please pay",
        "account statement",
      ],
      score: 0,
    },
    {
      type: "receipt",
      keywords: [
        "receipt",
        "quittung",
        "paid",
        "payment received",
        "thank you for your payment",
        "reçu",
      ],
      score: 0,
    },
    {
      type: "prescription",
      keywords: [
        "prescription",
        "rx",
        "dosage",
        "medication",
        "drug",
        "pharmacy",
        "rezept",
      ],
      score: 0,
    },
    {
      type: "lab_result",
      keywords: [
        "lab result",
        "test result",
        "blood test",
        "analysis",
        "laboratory",
        "laborbefund",
      ],
      score: 0,
    },
    {
      type: "insurance_statement",
      keywords: [
        "explanation of benefits",
        "eob",
        "claim summary",
        "insurance statement",
        "coverage",
        "reimbursement",
      ],
      score: 0,
    },
    {
      type: "appointment",
      keywords: [
        "appointment",
        "termin",
        "rendez-vous",
        "session",
        "visit",
        "consultation",
        "meeting with doctor",
      ],
      score: 0,
    },
    {
      type: "correspondence",
      keywords: [
        "dear",
        "confirmation",
        "reminder",
        "follow-up",
        "referral",
      ],
      score: 0,
    },
  ];

  // Score each classification
  for (const cls of classifications) {
    for (const keyword of cls.keywords) {
      if (combined.includes(keyword)) {
        cls.score += 1;
      }
    }
  }

  // Find highest scoring
  classifications.sort((a, b) => b.score - a.score);
  if (classifications[0]!.score > 0) {
    return classifications[0]!.type;
  }

  return "unknown";
}

/**
 * Check if text appears to be medical-related.
 */
function isMedicalRelated(text: string, subject?: string): boolean {
  const combined = `${subject ?? ""} ${text}`.toLowerCase();
  return MEDICAL_KEYWORDS.some((keyword) =>
    combined.includes(keyword.toLowerCase())
  );
}

/**
 * Extract medical keywords found in text.
 */
function extractMedicalKeywords(text: string): string[] {
  const combined = text.toLowerCase();
  return MEDICAL_KEYWORDS.filter((keyword) =>
    combined.includes(keyword.toLowerCase())
  );
}

/**
 * Document processor configuration.
 */
export interface ProcessorConfig {
  /** QweN API client */
  client?: QwenClient;
  /** Accounts to process (empty = all) */
  accounts?: string[];
  /** Search queries for finding medical emails */
  searchQueries?: string[];
  /** Search queries for finding medical calendar events */
  calendarQueries?: string[];
  /** Maximum emails to process per query */
  maxEmailsPerQuery?: number;
  /** Maximum calendar events to process per query */
  maxCalendarEventsPerQuery?: number;
  /** Skip emails already processed */
  skipExisting?: boolean;
  /** Process calendar events (default: true) */
  processCalendar?: boolean;
}

const DEFAULT_SEARCH_QUERIES = [
  "doctor appointment",
  "medical invoice",
  "healthcare bill",
  "therapy session",
  "prescription",
  "hospital",
  "clinic",
  "insurance claim",
  "reimbursement",
  "psychotherapy",
  "dentist",
  "optometrist",
];

const DEFAULT_CALENDAR_QUERIES = [
  "doctor",
  "therapy",
  "psychotherapy",
  "psychiatrist",
  "psychologist",
  "dentist",
  "optometrist",
  "hospital",
  "clinic",
  "medical",
  "appointment",
  "consultation",
  "treatment",
  "checkup",
  "physiotherapy",
];

/**
 * Document processor service.
 */
export class DocumentProcessor {
  private client: QwenClient;
  private config: ProcessorConfig;

  constructor(config: ProcessorConfig = {}) {
    this.client = config.client ?? qwenClient;
    this.config = {
      searchQueries: config.searchQueries ?? DEFAULT_SEARCH_QUERIES,
      calendarQueries: config.calendarQueries ?? DEFAULT_CALENDAR_QUERIES,
      maxEmailsPerQuery: config.maxEmailsPerQuery ?? 1000,
      maxCalendarEventsPerQuery: config.maxCalendarEventsPerQuery ?? 1000,
      skipExisting: config.skipExisting ?? true,
      processCalendar: config.processCalendar ?? true,
      ...config,
    };

    // Ensure storage directories exist
    ensureStorageDirs();
  }

  /**
   * Process a single email and its attachments.
   */
  async processEmail(email: EmailSearchResult): Promise<MedicalDocument[]> {
    const documents: MedicalDocument[] = [];

    // Check if email body is medical-related
    const emailText = `${email.subject} ${email.body ?? email.snippet}`;
    if (isMedicalRelated(emailText)) {
      // Check if already processed - only skip the email body, NOT attachments
      if (this.config.skipExisting) {
        const existing = await findDocumentByEmailId(email.id);
        if (existing) {
          documents.push(existing);
          // Don't return early - still need to check for new attachments below
        }
      }

      // Create document for email body (if not already existing)
      if (!documents.some((d) => d.emailId === email.id && d.sourceType === "email")) {
        const emailDoc: CreateMedicalDocumentInput = {
          sourceType: "email",
          emailId: email.id,
          account: email.account,
          subject: email.subject,
          fromAddress: email.from,
          toAddress: email.to,
          bodySnippet: email.snippet,
          date: new Date(email.date),
          ocrText: email.body ?? email.snippet,
          ocrCharCount: (email.body ?? email.snippet).length,
          detectedAmounts: extractAmounts(emailText),
          classification: classifyDocument(email.body ?? email.snippet, email.subject),
          medicalKeywords: extractMedicalKeywords(emailText),
        };

        const doc = await createMedicalDocument(emailDoc);
        documents.push(doc);
      }
    }

    // Process attachments if email has any (always check, even if email body was skipped)
    if (email.has_attachments) {
      try {
        // Fetch full email to get attachment details
        const fullEmail = await this.client.getEmail(email.id, email.account);
        if (fullEmail.status === "success" && fullEmail.email?.attachments) {
          for (const attachment of fullEmail.email.attachments) {
            try {
              const doc = await this.processAttachment(email, attachment);
              if (doc) {
                documents.push(doc);
              }
            } catch (err) {
              console.error(
                `Failed to process attachment ${attachment.filename}:`,
                err
              );
            }
          }
        }
      } catch (err) {
        console.error(`Failed to fetch full email ${email.id}:`, err);
      }
    }

    return documents;
  }

  /**
   * Process a single attachment.
   */
  async processAttachment(
    email: EmailSearchResult,
    attachment: EmailAttachment
  ): Promise<MedicalDocument | null> {
    // Check if file can be OCR'd
    if (!canOcr(attachment.filename)) {
      return null;
    }

    // Get attachment path
    const attachmentPath =
      attachment.path ??
      path.join(
        process.env.HOME ?? "",
        ".qwen",
        "data",
        email.account,
        "gmail",
        "attachments",
        email.id,
        attachment.filename
      );

    // Check if file exists
    if (!fs.existsSync(attachmentPath)) {
      console.warn(`Attachment not found: ${attachmentPath}`);
      return null;
    }

    // Check if already processed
    if (this.config.skipExisting) {
      const existing = await findDocumentByAttachmentPath(attachmentPath);
      if (existing) {
        return existing;
      }
    }

    // OCR the attachment
    const ocrResult = await this.client.ocrDocument(attachmentPath);

    if (ocrResult.status !== "success" || !ocrResult.text) {
      console.warn(`OCR failed for ${attachment.filename}:`, ocrResult.error);
      return null;
    }

    const ocrText = ocrResult.text;

    // Check if content is medical-related
    if (!isMedicalRelated(ocrText, email.subject)) {
      return null;
    }

    // Create document
    const docInput: CreateMedicalDocumentInput = {
      sourceType: "attachment",
      emailId: email.id,
      account: email.account,
      attachmentPath,
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      fileSize: attachment.size,
      subject: email.subject,
      fromAddress: email.from,
      toAddress: email.to,
      date: new Date(email.date),
      ocrText,
      ocrCharCount: ocrResult.char_count ?? ocrText.length,
      detectedAmounts: extractAmounts(ocrText),
      classification: classifyDocument(ocrText, email.subject),
      medicalKeywords: extractMedicalKeywords(ocrText),
    };

    return createMedicalDocument(docInput);
  }

  /**
   * Search for and process medical-related emails.
   *
   * Uses the BM25 FTS endpoint (searchEmailsFTS) which returns complete email
   * entities ranked by relevance. This is the preferred method for discovery.
   */
  async processEmailsFromSearch(): Promise<MedicalDocument[]> {
    const allDocuments: MedicalDocument[] = [];
    const processedEmailIds = new Set<string>();

    for (const query of this.config.searchQueries ?? []) {
      try {
        // Use FTS endpoint for BM25-ranked search with complete email entities
        const searchResult = await this.client.searchEmailsFTS(query, {
          ...(this.config.accounts?.[0] && { account: this.config.accounts[0] }),
          limit: this.config.maxEmailsPerQuery ?? 20,
        });

        if (searchResult.status !== "success" || !searchResult.results) {
          console.warn(`Search failed for query "${query}":`, searchResult.error);
          continue;
        }

        console.log(
          `[FTS] Query "${query}": ${searchResult.count ?? 0} results ` +
          `(${searchResult.total_matches ?? 0} total matches, index size: ${searchResult.index_size ?? 0})`
        );

        for (const email of searchResult.results) {
          // Skip already processed in this run
          if (processedEmailIds.has(email.id)) {
            continue;
          }
          processedEmailIds.add(email.id);

          try {
            const docs = await this.processEmail(email);
            allDocuments.push(...docs);
          } catch (err) {
            console.error(`Failed to process email ${email.id}:`, err);
          }
        }
      } catch (err) {
        console.error(`Search failed for query "${query}":`, err);
      }
    }

    return allDocuments;
  }

  /**
   * Process all attachments in a directory.
   * Useful for batch processing existing attachment dumps.
   */
  async processAttachmentDirectory(
    dirPath: string,
    account: string
  ): Promise<MedicalDocument[]> {
    const documents: MedicalDocument[] = [];

    if (!fs.existsSync(dirPath)) {
      console.warn(`Directory not found: ${dirPath}`);
      return documents;
    }

    const emailDirs = fs.readdirSync(dirPath);

    for (const emailId of emailDirs) {
      const emailDir = path.join(dirPath, emailId);
      const stat = fs.statSync(emailDir);

      if (!stat.isDirectory()) continue;

      const files = fs.readdirSync(emailDir);

      for (const filename of files) {
        if (!canOcr(filename)) continue;

        const attachmentPath = path.join(emailDir, filename);

        try {
          // Check if already processed
          if (this.config.skipExisting) {
            const existing = await findDocumentByAttachmentPath(attachmentPath);
            if (existing) {
              documents.push(existing);
              continue;
            }
          }

          // OCR the file
          const ocrResult = await this.client.ocrDocument(attachmentPath);

          if (ocrResult.status !== "success" || !ocrResult.text) {
            continue;
          }

          const ocrText = ocrResult.text;

          // Only process medical-related content
          if (!isMedicalRelated(ocrText)) {
            continue;
          }

          const docInput: CreateMedicalDocumentInput = {
            sourceType: "attachment",
            emailId,
            account,
            attachmentPath,
            filename,
            ocrText,
            ocrCharCount: ocrResult.char_count ?? ocrText.length,
            detectedAmounts: extractAmounts(ocrText),
            classification: classifyDocument(ocrText),
            medicalKeywords: extractMedicalKeywords(ocrText),
          };

          const doc = await createMedicalDocument(docInput);
          documents.push(doc);
        } catch (err) {
          console.error(`Failed to process ${attachmentPath}:`, err);
        }
      }
    }

    return documents;
  }

  /**
   * Process a single calendar event.
   */
  async processCalendarEvent(
    event: CalendarEventSearchResult
  ): Promise<MedicalDocument | null> {
    // Build searchable text from event
    const eventText = [
      event.summary,
      event.description,
      event.location,
    ]
      .filter(Boolean)
      .join(" ");

    // Check if event appears medical-related
    if (!isMedicalRelated(eventText)) {
      return null;
    }

    // Check if already processed
    if (this.config.skipExisting) {
      const existing = await findDocumentByCalendarEventId(event.id);
      if (existing) {
        return existing;
      }
    }

    // Convert attendees to our format (filter undefined values)
    const calendarAttendees: CalendarAttendee[] | undefined = event.attendees?.map(
      (a): CalendarAttendee => ({
        email: a.email,
        ...(a.name && { name: a.name }),
        ...(a.response && { response: a.response }),
        ...(a.organizer !== undefined && { organizer: a.organizer }),
      })
    );

    // Create document for calendar event
    // Use spread to conditionally include optional properties
    const docInput: CreateMedicalDocumentInput = {
      sourceType: "calendar",
      account: event.account,
      date: new Date(event.start),
      // Calendar-specific fields
      calendarEventId: event.id,
      calendarId: event.calendar_id,
      calendarSummary: event.summary,
      ...(event.description && { calendarDescription: event.description }),
      ...(event.location && { calendarLocation: event.location }),
      calendarStart: new Date(event.start),
      calendarEnd: new Date(event.end),
      calendarAllDay: event.all_day,
      ...(calendarAttendees && { calendarAttendees }),
      ...(event.organizer && {
        calendarOrganizer: {
          ...(event.organizer.email && { email: event.organizer.email }),
          ...(event.organizer.display_name && { displayName: event.organizer.display_name }),
        },
      }),
      ...(event.conference?.video_url && { calendarConferenceUrl: event.conference.video_url }),
      // Use event text as searchable content
      ocrText: eventText,
      ocrCharCount: eventText.length,
      // Calendar events typically don't have amounts
      detectedAmounts: extractAmounts(eventText),
      classification: classifyDocument(eventText, event.summary, true),
      medicalKeywords: extractMedicalKeywords(eventText),
      // Use summary as subject for consistency
      subject: event.summary,
    };

    return createMedicalDocument(docInput);
  }

  /**
   * Search for and process medical-related calendar events.
   *
   * Uses the BM25 FTS endpoint (searchCalendarFTS) which returns complete event
   * entities ranked by relevance.
   */
  async processCalendarEventsFromSearch(): Promise<MedicalDocument[]> {
    const allDocuments: MedicalDocument[] = [];
    const processedEventIds = new Set<string>();

    for (const query of this.config.calendarQueries ?? []) {
      try {
        const searchResult = await this.client.searchCalendarFTS(query, {
          ...(this.config.accounts?.[0] && { account: this.config.accounts[0] }),
          limit: this.config.maxCalendarEventsPerQuery,
        });

        if (searchResult.status !== "success" || !searchResult.results) {
          console.warn(
            `Calendar search failed for query "${query}":`,
            searchResult.error
          );
          continue;
        }

        console.log(
          `[Calendar FTS] Query "${query}": ${searchResult.count ?? 0} results ` +
            `(${searchResult.total_matches ?? 0} total matches)`
        );

        for (const event of searchResult.results) {
          // Skip already processed in this run
          if (processedEventIds.has(event.id)) {
            continue;
          }
          processedEventIds.add(event.id);

          try {
            const doc = await this.processCalendarEvent(event);
            if (doc) {
              allDocuments.push(doc);
            }
          } catch (err) {
            console.error(`Failed to process calendar event ${event.id}:`, err);
          }
        }
      } catch (err) {
        console.error(`Calendar search failed for query "${query}":`, err);
      }
    }

    return allDocuments;
  }

  /**
   * Run the full document processing workflow.
   */
  async run(): Promise<MedicalDocument[]> {
    console.log("Starting document processing...");

    // Process emails from search
    const emailDocs = await this.processEmailsFromSearch();
    console.log(`Processed ${emailDocs.length} email/attachment documents`);

    // Process calendar events if enabled
    let calendarDocs: MedicalDocument[] = [];
    if (this.config.processCalendar) {
      calendarDocs = await this.processCalendarEventsFromSearch();
      console.log(`Processed ${calendarDocs.length} calendar documents`);
    }

    const allDocs = [...emailDocs, ...calendarDocs];
    console.log(`Total: ${allDocs.length} medical documents processed`);

    return allDocs;
  }
}

/**
 * Create a document processor with default configuration.
 */
export function createDocumentProcessor(
  config?: ProcessorConfig
): DocumentProcessor {
  return new DocumentProcessor(config);
}
