/**
 * Processing State Storage
 *
 * Tracks high-water marks for incremental processing.
 * Uses SQLite for fast lookups.
 */

import { getDatabase } from "./sqlite.js";
import { getStorageBackend } from "./repository.js";

/**
 * Processing state record.
 */
export interface ProcessingState {
  id: string;
  query: string;
  account: string | null;
  lastProcessedDate: Date | null;
  lastRunAt: Date | null;
}

/**
 * Get processing state for a query/account combination.
 */
export async function getProcessingState(
  query: string,
  account?: string
): Promise<ProcessingState | null> {
  if (getStorageBackend() !== "sqlite") {
    // No state tracking without SQLite
    return null;
  }

  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT id, query, account, last_processed_date, last_run_at
       FROM processing_state
       WHERE query = ? AND (account = ? OR (account IS NULL AND ? IS NULL))
       LIMIT 1`
    )
    .get(query, account ?? null, account ?? null) as
      | { id: string; query: string; account: string | null; last_processed_date: string | null; last_run_at: string | null }
      | undefined;

  if (!row) return null;

  return {
    id: row.id,
    query: row.query,
    account: row.account,
    lastProcessedDate: row.last_processed_date ? new Date(row.last_processed_date) : null,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
  };
}

/**
 * Update processing state for a query/account combination.
 */
export async function updateProcessingState(
  query: string,
  account: string | undefined,
  lastProcessedDate: Date
): Promise<void> {
  if (getStorageBackend() !== "sqlite") {
    return;
  }

  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO processing_state (id, query, account, last_processed_date, last_run_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(query, account) DO UPDATE SET
       last_processed_date = CASE
         WHEN excluded.last_processed_date > processing_state.last_processed_date
           OR processing_state.last_processed_date IS NULL
         THEN excluded.last_processed_date
         ELSE processing_state.last_processed_date
       END,
       last_run_at = excluded.last_run_at,
       updated_at = excluded.updated_at`
  ).run(
    `state-${query}-${account ?? "all"}`,
    query,
    account ?? null,
    lastProcessedDate.toISOString(),
    now,
    now
  );
}

/**
 * Get all processing states.
 */
export async function getAllProcessingStates(): Promise<ProcessingState[]> {
  if (getStorageBackend() !== "sqlite") {
    return [];
  }

  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, query, account, last_processed_date, last_run_at
       FROM processing_state
       ORDER BY last_run_at DESC`
    )
    .all() as Array<{
      id: string;
      query: string;
      account: string | null;
      last_processed_date: string | null;
      last_run_at: string | null;
    }>;

  return rows.map((row) => ({
    id: row.id,
    query: row.query,
    account: row.account,
    lastProcessedDate: row.last_processed_date ? new Date(row.last_processed_date) : null,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
  }));
}

/**
 * Reset processing state for a query/account (forces full rescan).
 */
export async function resetProcessingState(
  query: string,
  account?: string
): Promise<void> {
  if (getStorageBackend() !== "sqlite") {
    return;
  }

  const db = getDatabase();
  db.prepare(
    `DELETE FROM processing_state
     WHERE query = ? AND (account = ? OR (account IS NULL AND ? IS NULL))`
  ).run(query, account ?? null, account ?? null);
}

/**
 * Reset all processing states.
 */
export async function resetAllProcessingStates(): Promise<void> {
  if (getStorageBackend() !== "sqlite") {
    return;
  }

  const db = getDatabase();
  db.prepare("DELETE FROM processing_state").run();
}

/**
 * Generate date windows for incremental processing.
 * Returns windows from startDate to now, with the specified window size.
 */
export function generateDateWindows(
  startDate: Date | null,
  windowDays: number = 30
): Array<{ afterDate: string; beforeDate: string }> {
  const windows: Array<{ afterDate: string; beforeDate: string }> = [];
  const now = new Date();

  // If no start date, use a year ago
  let current = startDate ? new Date(startDate) : new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  while (current < now) {
    const windowEnd = new Date(current.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const beforeDate = windowEnd > now ? now : windowEnd;

    windows.push({
      afterDate: current.toISOString().split("T")[0]!,
      beforeDate: beforeDate.toISOString().split("T")[0]!,
    });

    current = windowEnd;
  }

  return windows;
}
