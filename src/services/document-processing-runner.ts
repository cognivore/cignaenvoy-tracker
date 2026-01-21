/**
 * Background document processing scheduler.
 *
 * Supports two modes:
 * - Incremental: Short interval, only processes new emails since last run
 * - Full-history: Longer interval, processes all matching emails
 *
 * Set STORAGE_BACKEND=sqlite to enable incremental processing with state tracking.
 */

import type { MedicalDocument } from "../types/medical-document.js";
import { DocumentProcessor } from "./document-processor.js";
import { getStorageBackend } from "../storage/repository.js";

const DEFAULT_INCREMENTAL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_FULL_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STARTUP_DELAY_MS = 5_000;

let isRunning = false;

export type ProcessingMode = "incremental" | "full";

export interface ProcessingOptions {
  mode?: ProcessingMode;
}

/**
 * Run document processing.
 *
 * @param trigger - What triggered this run
 * @param options - Processing options
 */
export async function runDocumentProcessing(
  trigger: "manual" | "scheduled" | "startup",
  options: ProcessingOptions = {}
): Promise<MedicalDocument[]> {
  if (isRunning) {
    console.log(`[DocumentProcessing] Skipping (${trigger}) - already running`);
    return [];
  }

  // Determine mode: use SQLite for incremental if available
  const backend = getStorageBackend();
  const mode = options.mode ?? (backend === "sqlite" ? "incremental" : "full");

  isRunning = true;
  try {
    console.log(`[DocumentProcessing] Starting (${trigger}, ${mode} mode)...`);

    const processor = new DocumentProcessor({
      fullHistory: mode === "full",
      incremental: mode === "incremental",
      skipExisting: true,
      processCalendar: true,
      // Higher concurrency for incremental (less data)
      emailConcurrency: mode === "incremental" ? 16 : 8,
    });

    const documents = await processor.run(trigger);
    console.log(
      `[DocumentProcessing] Completed (${trigger}): ${documents.length} documents`
    );
    return documents;
  } catch (err) {
    console.error(`[DocumentProcessing] Failed (${trigger}):`, err);
    return [];
  } finally {
    isRunning = false;
  }
}

/**
 * Start the document processing schedule.
 *
 * With SQLite backend:
 * - Incremental scans every 15 minutes
 * - Full rescans every 24 hours
 *
 * Without SQLite:
 * - Full scans every 3 hours (legacy behavior)
 */
export function startDocumentProcessingSchedule(
  incrementalIntervalMs: number = DEFAULT_INCREMENTAL_INTERVAL_MS,
  fullScanIntervalMs: number = DEFAULT_FULL_SCAN_INTERVAL_MS
): void {
  const backend = getStorageBackend();

  if (backend === "sqlite") {
    console.log(
      `[DocumentProcessing] Schedule: incremental every ${incrementalIntervalMs / 1000 / 60}min, ` +
      `full scan every ${fullScanIntervalMs / 1000 / 60 / 60}h`
    );

    // Incremental scan at startup
    setTimeout(() => {
      void runDocumentProcessing("startup", { mode: "incremental" });
    }, STARTUP_DELAY_MS);

    // Regular incremental scans
    setInterval(() => {
      void runDocumentProcessing("scheduled", { mode: "incremental" });
    }, incrementalIntervalMs);

    // Periodic full rescans
    setInterval(() => {
      void runDocumentProcessing("scheduled", { mode: "full" });
    }, fullScanIntervalMs);
  } else {
    // Legacy: full scans every 3 hours
    const legacyInterval = 3 * 60 * 60 * 1000;
    console.log(
      `[DocumentProcessing] Schedule: full scan every ${legacyInterval / 1000 / 60 / 60}h (set STORAGE_BACKEND=sqlite for incremental)`
    );

    setTimeout(() => {
      void runDocumentProcessing("startup", { mode: "full" });
    }, STARTUP_DELAY_MS);

    setInterval(() => {
      void runDocumentProcessing("scheduled", { mode: "full" });
    }, legacyInterval);
  }
}
