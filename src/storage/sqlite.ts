/**
 * SQLite Storage Backend
 *
 * High-performance indexed storage using better-sqlite3.
 * Provides fast lookups for document deduplication and stats aggregation.
 */

import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Repository, IndexedRepository } from "./repository.js";

/** Base data directory */
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "cigna-tracker.db");

let db: Database.Database | null = null;

/**
 * Get or create the SQLite database connection.
 */
export function getDatabase(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);
  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Initialize database schema.
 */
function initializeSchema(database: Database.Database): void {
  database.exec(`
    -- Documents table
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      email_id TEXT,
      attachment_path TEXT,
      calendar_event_id TEXT,
      source_type TEXT,
      account TEXT,
      date TEXT,
      classification TEXT,
      archived_at TEXT,
      processed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_documents_email_id ON documents(email_id);
    CREATE INDEX IF NOT EXISTS idx_documents_attachment_path ON documents(attachment_path);
    CREATE INDEX IF NOT EXISTS idx_documents_calendar_event_id ON documents(calendar_event_id);
    CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);
    CREATE INDEX IF NOT EXISTS idx_documents_account ON documents(account);
    CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(date);
    CREATE INDEX IF NOT EXISTS idx_documents_classification ON documents(classification);
    CREATE INDEX IF NOT EXISTS idx_documents_archived_at ON documents(archived_at);
    CREATE INDEX IF NOT EXISTS idx_documents_processed_at ON documents(processed_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_email_source ON documents(email_id, source_type) WHERE email_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_attachment ON documents(attachment_path) WHERE attachment_path IS NOT NULL;

    -- Attachment processing records
    CREATE TABLE IF NOT EXISTS attachment_processing (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      attachment_path TEXT,
      email_id TEXT,
      account TEXT,
      status TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_attachment_processing_path ON attachment_processing(attachment_path);
    CREATE INDEX IF NOT EXISTS idx_attachment_processing_email_id ON attachment_processing(email_id);
    CREATE INDEX IF NOT EXISTS idx_attachment_processing_status ON attachment_processing(status);

    -- Archive rules
    CREATE TABLE IF NOT EXISTS archive_rules (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      name TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_archive_rules_enabled ON archive_rules(enabled);

    -- Claims
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      cigna_claim_id TEXT,
      status TEXT,
      archived_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_claims_cigna_claim_id ON claims(cigna_claim_id);
    CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
    CREATE INDEX IF NOT EXISTS idx_claims_archived_at ON claims(archived_at);

    -- Draft claims
    CREATE TABLE IF NOT EXISTS draft_claims (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      status TEXT,
      archived_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_draft_claims_status ON draft_claims(status);
    CREATE INDEX IF NOT EXISTS idx_draft_claims_archived_at ON draft_claims(archived_at);

    -- Assignments
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      document_id TEXT,
      claim_id TEXT,
      status TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_document_id ON assignments(document_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_claim_id ON assignments(claim_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);

    -- Patients
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);

    -- Illnesses
    CREATE TABLE IF NOT EXISTS illnesses (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      patient_id TEXT,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_illnesses_patient_id ON illnesses(patient_id);
    CREATE INDEX IF NOT EXISTS idx_illnesses_name ON illnesses(name);

    -- Processing state (for incremental processing)
    CREATE TABLE IF NOT EXISTS processing_state (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      account TEXT,
      last_processed_date TEXT,
      last_run_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_state_query_account ON processing_state(query, account);
  `);
}

/**
 * Date reviver for JSON parsing.
 */
function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === "string") {
    const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    if (dateRegex.test(value)) {
      return new Date(value);
    }
  }
  return value;
}

/**
 * Field mapping from entity property to database column.
 */
interface FieldMapping {
  column: string;
  property: string;
}

/**
 * Create a SQLite repository for a specific table.
 * 
 * @param tableName - The database table name
 * @param fieldMappings - Array of field mappings from entity properties to database columns
 */
export function createSqliteRepository<T extends { id: string }>(
  tableName: string,
  fieldMappings: FieldMapping[] = []
): IndexedRepository<T> {
  const database = getDatabase();

  // Extract indexed field value from entity using property name
  const getFieldValue = (entity: T, property: string): string | null => {
    const value = (entity as Record<string, unknown>)[property];
    if (value === undefined || value === null) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  // Build indexed field columns for upsert
  const indexedFieldColumns = fieldMappings.map((f) => f.column);

  return {
    async save(entity: T): Promise<T> {
      const data = JSON.stringify(entity);
      const now = new Date().toISOString();

      // Build column list and values for indexed fields
      const columns = ["id", "data", "updated_at", ...indexedFieldColumns];
      const placeholders = columns.map(() => "?").join(", ");
      const values = [
        entity.id,
        data,
        now,
        ...fieldMappings.map((f) => getFieldValue(entity, f.property)),
      ];

      const sql = `
        INSERT INTO ${tableName} (${columns.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at
          ${indexedFieldColumns.length > 0 ? ", " + indexedFieldColumns.map((f) => `${f} = excluded.${f}`).join(", ") : ""}
      `;

      database.prepare(sql).run(...values);
      return entity;
    },

    async get(id: string): Promise<T | null> {
      const row = database
        .prepare(`SELECT data FROM ${tableName} WHERE id = ?`)
        .get(id) as { data: string } | undefined;

      if (!row) return null;
      return JSON.parse(row.data, dateReviver) as T;
    },

    async getAll(): Promise<T[]> {
      const rows = database
        .prepare(`SELECT data FROM ${tableName}`)
        .all() as { data: string }[];

      return rows.map((row) => JSON.parse(row.data, dateReviver) as T);
    },

    async delete(id: string): Promise<boolean> {
      const result = database
        .prepare(`DELETE FROM ${tableName} WHERE id = ?`)
        .run(id);

      return result.changes > 0;
    },

    async exists(id: string): Promise<boolean> {
      const row = database
        .prepare(`SELECT 1 FROM ${tableName} WHERE id = ? LIMIT 1`)
        .get(id);

      return !!row;
    },

    async find(predicate: (entity: T) => boolean): Promise<T[]> {
      const all = await this.getAll();
      return all.filter(predicate);
    },

    async count(): Promise<number> {
      const row = database
        .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
        .get() as { count: number };

      return row.count;
    },

    async findByIndex<K extends keyof T>(field: K, value: T[K]): Promise<T | null> {
      const fieldName = String(field);
      const searchValue = value instanceof Date ? value.toISOString() : value;

      const row = database
        .prepare(`SELECT data FROM ${tableName} WHERE ${fieldName} = ? LIMIT 1`)
        .get(searchValue) as { data: string } | undefined;

      if (!row) return null;
      return JSON.parse(row.data, dateReviver) as T;
    },

    async findAllByIndex<K extends keyof T>(field: K, value: T[K]): Promise<T[]> {
      const fieldName = String(field);
      const searchValue = value instanceof Date ? value.toISOString() : value;

      const rows = database
        .prepare(`SELECT data FROM ${tableName} WHERE ${fieldName} = ?`)
        .all(searchValue) as { data: string }[];

      return rows.map((row) => JSON.parse(row.data, dateReviver) as T);
    },

    async countByIndex<K extends keyof T>(field: K, value: T[K]): Promise<number> {
      const fieldName = String(field);
      const searchValue = value instanceof Date ? value.toISOString() : value;

      const row = database
        .prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE ${fieldName} = ?`)
        .get(searchValue) as { count: number };

      return row.count;
    },
  };
}

/**
 * Stats query helpers for fast aggregation.
 */
export interface StatsResult {
  claims: number;
  documents: number;
  assignments: {
    total: number;
    candidates: number;
    confirmed: number;
    rejected: number;
  };
  draftClaims: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
  };
}

/**
 * Get stats using SQL aggregation (fast).
 */
export function getStatsFast(): StatsResult {
  const database = getDatabase();

  const claimsCount = (
    database.prepare("SELECT COUNT(*) as count FROM claims").get() as { count: number }
  ).count;

  const documentsCount = (
    database.prepare("SELECT COUNT(*) as count FROM documents").get() as { count: number }
  ).count;

  const assignmentsTotal = (
    database.prepare("SELECT COUNT(*) as count FROM assignments").get() as { count: number }
  ).count;

  const assignmentsCandidates = (
    database.prepare("SELECT COUNT(*) as count FROM assignments WHERE status = 'candidate'").get() as { count: number }
  ).count;

  const assignmentsConfirmed = (
    database.prepare("SELECT COUNT(*) as count FROM assignments WHERE status = 'confirmed'").get() as { count: number }
  ).count;

  const assignmentsRejected = (
    database.prepare("SELECT COUNT(*) as count FROM assignments WHERE status = 'rejected'").get() as { count: number }
  ).count;

  const draftClaimsTotal = (
    database.prepare("SELECT COUNT(*) as count FROM draft_claims").get() as { count: number }
  ).count;

  const draftClaimsPending = (
    database.prepare("SELECT COUNT(*) as count FROM draft_claims WHERE status = 'pending'").get() as { count: number }
  ).count;

  const draftClaimsAccepted = (
    database.prepare("SELECT COUNT(*) as count FROM draft_claims WHERE status = 'accepted'").get() as { count: number }
  ).count;

  const draftClaimsRejected = (
    database.prepare("SELECT COUNT(*) as count FROM draft_claims WHERE status = 'rejected'").get() as { count: number }
  ).count;

  return {
    claims: claimsCount,
    documents: documentsCount,
    assignments: {
      total: assignmentsTotal,
      candidates: assignmentsCandidates,
      confirmed: assignmentsConfirmed,
      rejected: assignmentsRejected,
    },
    draftClaims: {
      total: draftClaimsTotal,
      pending: draftClaimsPending,
      accepted: draftClaimsAccepted,
      rejected: draftClaimsRejected,
    },
  };
}

/**
 * Documents-specific indexed lookups.
 */
export function findDocumentByEmailIdSqlite(emailId: string): Promise<unknown | null> {
  const database = getDatabase();
  const row = database
    .prepare("SELECT data FROM documents WHERE email_id = ? LIMIT 1")
    .get(emailId) as { data: string } | undefined;

  if (!row) return Promise.resolve(null);
  return Promise.resolve(JSON.parse(row.data, dateReviver));
}

export function findDocumentByAttachmentPathSqlite(attachmentPath: string): Promise<unknown | null> {
  const database = getDatabase();
  const row = database
    .prepare("SELECT data FROM documents WHERE attachment_path = ? LIMIT 1")
    .get(attachmentPath) as { data: string } | undefined;

  if (!row) return Promise.resolve(null);
  return Promise.resolve(JSON.parse(row.data, dateReviver));
}

export function findDocumentByCalendarEventIdSqlite(calendarEventId: string): Promise<unknown | null> {
  const database = getDatabase();
  const row = database
    .prepare("SELECT data FROM documents WHERE calendar_event_id = ? LIMIT 1")
    .get(calendarEventId) as { data: string } | undefined;

  if (!row) return Promise.resolve(null);
  return Promise.resolve(JSON.parse(row.data, dateReviver));
}

/**
 * Attachment processing indexed lookup.
 */
export function findAttachmentProcessingByPathSqlite(attachmentPath: string): Promise<unknown | null> {
  const database = getDatabase();
  const row = database
    .prepare("SELECT data FROM attachment_processing WHERE attachment_path = ? LIMIT 1")
    .get(attachmentPath) as { data: string } | undefined;

  if (!row) return Promise.resolve(null);
  return Promise.resolve(JSON.parse(row.data, dateReviver));
}
