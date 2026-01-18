/**
 * Background document processing scheduler.
 *
 * Runs full-history scans on a fixed interval while avoiding overlap.
 */

import type { MedicalDocument } from "../types/medical-document.js";
import { DocumentProcessor } from "./document-processor.js";

const DEFAULT_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
let isRunning = false;

export async function runDocumentProcessing(
  trigger: "manual" | "scheduled" | "startup"
): Promise<MedicalDocument[]> {
  if (isRunning) {
    console.log(`[DocumentProcessing] Skipping (${trigger}) - already running`);
    return [];
  }

  isRunning = true;
  try {
    console.log(`[DocumentProcessing] Starting (${trigger})...`);
    const processor = new DocumentProcessor({
      fullHistory: true,
      skipExisting: true,
      processCalendar: true,
    });
    const documents = await processor.run();
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

export function startDocumentProcessingSchedule(
  intervalMs: number = DEFAULT_INTERVAL_MS
): void {
  // Run once at startup after a short delay.
  setTimeout(() => {
    void runDocumentProcessing("startup");
  }, 5_000);

  setInterval(() => {
    void runDocumentProcessing("scheduled");
  }, intervalMs);
}
