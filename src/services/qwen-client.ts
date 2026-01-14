/**
 * QweN API Client
 *
 * Client for interacting with the local QweN daemon API.
 * Provides OCR and email/calendar search capabilities.
 *
 * NOTE: Updated to support the new FTS (full-text search) endpoints from whisper-mlx:
 * - search_emails_fts: BM25-ranked email search returning full entities
 * - search_calendar_fts: BM25-ranked calendar search returning full entities
 */

/** Base URL for QweN API */
const QWEN_BASE_URL = "http://127.0.0.1:5997";

/**
 * Health check response from QweN daemon.
 */
export interface QwenHealthResponse {
  status: string;
  model?: string;
  profiles?: string[];
  tools?: string[];
}

/**
 * OCR document response.
 */
export interface OcrDocumentResponse {
  status: "success" | "error";
  file?: string;
  type?: "image" | "pdf";
  text?: string;
  char_count?: number;
  total_pages?: number;
  pages_processed?: number;
  page_details?: Array<{
    page: number;
    text: string;
    char_count: number;
  }>;
  error?: string;
}

/**
 * Email attachment info from search results.
 */
export interface EmailAttachment {
  filename: string;
  size: number;
  mime_type: string;
  path?: string;
}

/**
 * Email search result (matches whisper-mlx search_emails_fts output).
 * Includes BM25 ranking score and complete email entity.
 */
export interface EmailSearchResult {
  rank: number;
  score: number;
  id: string;
  account: string;
  thread_id?: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  body: string;
  snippet: string;
  labels?: string[];
  has_attachments: boolean;
  attachments?: EmailAttachment[];
}

/**
 * Email FTS search response (from search_emails_fts).
 */
export interface EmailFTSSearchResponse {
  status: "success" | "error";
  query?: string;
  count?: number;
  total_matches?: number;
  index_size?: number;
  results?: EmailSearchResult[];
  error?: string;
}

/**
 * Legacy email search response (from search_emails - filtered search).
 * Still supported for backwards compatibility.
 */
export interface EmailSearchResponse {
  status: "success" | "error";
  query?: string;
  count?: number;
  total_matches?: number;
  total_emails_searched?: number;
  searched_accounts?: string[];
  query_tokens?: string[];
  results?: Array<{
    id: string;
    account: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    snippet: string;
    has_attachments: boolean;
    attachment_count?: number;
  }>;
  error?: string;
}

/**
 * Calendar event search result (matches whisper-mlx search_calendar_fts output).
 */
export interface CalendarEventSearchResult {
  rank: number;
  score: number;
  id: string;
  account: string;
  calendar_id: string;
  calendar_name?: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  all_day: boolean;
  timezone?: string;
  status?: string;
  html_link?: string;
  organizer?: { email?: string; display_name?: string };
  creator?: { email?: string; display_name?: string };
  attendees?: Array<{
    email: string;
    name?: string;
    response?: string;
    organizer?: boolean;
  }>;
  conference?: {
    video_url?: string;
    phone?: string;
  };
  recurring_event_id?: string;
}

/**
 * Calendar FTS search response (from search_calendar_fts).
 */
export interface CalendarFTSSearchResponse {
  status: "success" | "error";
  query?: string;
  count?: number;
  total_matches?: number;
  index_size?: number;
  results?: CalendarEventSearchResult[];
  error?: string;
}

/**
 * Full email with attachments.
 */
export interface FullEmail {
  id: string;
  account: string;
  thread_id?: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  body: string;
  snippet: string;
  labels?: string[];
  has_attachments: boolean;
  attachments: EmailAttachment[];
  synced_at?: string;
}

/**
 * Full email response.
 */
export interface GetEmailResponse {
  status: "success" | "error";
  email?: FullEmail;
  error?: string;
}

/**
 * Tool invocation response wrapper.
 */
interface ToolInvokeResponse<T> {
  tool_name: string;
  result: T;
  latency_ms?: number;
}

/**
 * QweN API client for OCR and email operations.
 */
export class QwenClient {
  private baseUrl: string;

  constructor(baseUrl: string = QWEN_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Check if QweN daemon is healthy and running.
   */
  async health(): Promise<QwenHealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`QweN health check failed: ${response.status}`);
    }
    return response.json();
  }

  /**
   * List available tools.
   */
  async listTools(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/v1/tools`);
    if (!response.ok) {
      throw new Error(`Failed to list tools: ${response.status}`);
    }
    const data = await response.json();
    return data.tools || [];
  }

  /**
   * OCR a document (image or PDF).
   *
   * @param filePath - Path to the file to OCR
   * @param pages - For PDFs, which pages to process (default: "all")
   * @param dpi - DPI for PDF rendering (default: 200)
   */
  async ocrDocument(
    filePath: string,
    pages: string = "all",
    dpi: number = 200
  ): Promise<OcrDocumentResponse> {
    const response = await fetch(
      `${this.baseUrl}/v1/tools/ocr_document/invoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arguments: {
            file_path: filePath,
            pages,
            dpi,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`OCR request failed: ${response.status}`);
    }

    const data: ToolInvokeResponse<OcrDocumentResponse> = await response.json();
    return data.result;
  }

  /**
   * Search emails using BM25 full-text search (preferred).
   *
   * This uses the search_emails_fts endpoint which returns complete email
   * entities ranked by relevance score.
   *
   * @param query - Search query (keywords or phrases)
   * @param options - Search options
   */
  async searchEmailsFTS(
    query: string,
    options: {
      account?: string;
      afterDate?: string;
      beforeDate?: string;
      limit?: number;
    } = {}
  ): Promise<EmailFTSSearchResponse> {
    const response = await fetch(
      `${this.baseUrl}/v1/tools/search_emails_fts/invoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arguments: {
            query,
            account: options.account,
            after_date: options.afterDate,
            before_date: options.beforeDate,
            limit: options.limit ?? 50,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Email FTS search failed: ${response.status}`);
    }

    const data: ToolInvokeResponse<EmailFTSSearchResponse | string> = await response.json();
    // Handle both string (JSON-encoded) and object (already parsed) responses
    return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
  }

  /**
   * Search emails using filtered search (legacy).
   *
   * This uses the search_emails endpoint with criteria-based filtering.
   * Prefer searchEmailsFTS for keyword-based discovery.
   *
   * @param query - Search query
   * @param options - Search options
   */
  async searchEmails(
    query: string,
    options: {
      account?: string;
      fromEmail?: string;
      toEmail?: string;
      subject?: string;
      afterDate?: string;
      beforeDate?: string;
      hasAttachments?: boolean;
      limit?: number;
    } = {}
  ): Promise<EmailSearchResponse> {
    const response = await fetch(
      `${this.baseUrl}/v1/tools/search_emails/invoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arguments: {
            query,
            account: options.account,
            from_email: options.fromEmail,
            to_email: options.toEmail,
            subject: options.subject,
            after_date: options.afterDate,
            before_date: options.beforeDate,
            has_attachments: options.hasAttachments,
            limit: options.limit ?? 50,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Email search failed: ${response.status}`);
    }

    const data: ToolInvokeResponse<EmailSearchResponse | string> = await response.json();
    // Handle both string (JSON-encoded) and object (already parsed) responses
    return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
  }

  /**
   * Get full email by ID.
   *
   * @param emailId - The email message ID
   * @param account - Optional account to search in
   */
  async getEmail(emailId: string, account?: string): Promise<GetEmailResponse> {
    const response = await fetch(
      `${this.baseUrl}/v1/tools/get_email/invoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arguments: {
            email_id: emailId,
            account,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Get email failed: ${response.status}`);
    }

    const data: ToolInvokeResponse<GetEmailResponse | string> = await response.json();
    return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
  }

  /**
   * Search calendar events using BM25 full-text search (preferred).
   *
   * This uses the search_calendar_fts endpoint which returns complete event
   * entities ranked by relevance score.
   *
   * @param query - Search query
   * @param options - Search options
   */
  async searchCalendarFTS(
    query: string,
    options: {
      account?: string;
      afterDate?: string;
      beforeDate?: string;
      limit?: number;
    } = {}
  ): Promise<CalendarFTSSearchResponse> {
    const response = await fetch(
      `${this.baseUrl}/v1/tools/search_calendar_fts/invoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arguments: {
            query,
            account: options.account,
            after_date: options.afterDate,
            before_date: options.beforeDate,
            limit: options.limit ?? 50,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Calendar FTS search failed: ${response.status}`);
    }

    const data: ToolInvokeResponse<CalendarFTSSearchResponse | string> = await response.json();
    return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
  }

  /**
   * Search calendar events using filtered search (legacy).
   *
   * @deprecated Prefer searchCalendarFTS for keyword-based discovery.
   * @param query - Search query
   * @param options - Search options
   */
  async searchCalendar(
    query: string,
    options: {
      account?: string;
      afterDate?: string;
      beforeDate?: string;
      limit?: number;
    } = {}
  ): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl}/v1/tools/search_calendar/invoke`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arguments: {
            query,
            account: options.account,
            after_date: options.afterDate,
            before_date: options.beforeDate,
            limit: options.limit ?? 50,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Calendar search failed: ${response.status}`);
    }

    const data: ToolInvokeResponse<unknown> = await response.json();
    // Handle both string (JSON-encoded) and object (already parsed) responses
    return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
  }
}

/**
 * Default QweN client instance.
 */
export const qwenClient = new QwenClient();

/**
 * Supported image extensions for OCR.
 */
export const OCR_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
]);

/**
 * Supported PDF extension for OCR.
 */
export const OCR_PDF_EXTENSIONS = new Set([".pdf"]);

/**
 * All supported OCR extensions.
 */
export const OCR_SUPPORTED_EXTENSIONS = new Set([
  ...OCR_IMAGE_EXTENSIONS,
  ...OCR_PDF_EXTENSIONS,
]);

/**
 * Check if a file can be OCR'd based on extension.
 */
export function canOcr(filename: string): boolean {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return OCR_SUPPORTED_EXTENSIONS.has(ext);
}
