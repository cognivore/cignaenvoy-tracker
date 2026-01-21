/**
 * Migration script: JSON files → SQLite
 *
 * Streams all JSON entity files into SQLite database in a transaction.
 * Safe to run multiple times (idempotent via upsert).
 *
 * Usage: npx tsx src/scripts/migrate-to-sqlite.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getDatabase, closeDatabase } from "../storage/sqlite.js";
import { STORAGE_DIRS } from "../storage/base.js";

interface MigrationStats {
  table: string;
  migrated: number;
  errors: number;
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
 * Extract indexed field value from entity.
 */
function getFieldValue(entity: Record<string, unknown>, field: string): string | null {
  const value = entity[field];
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Migrate a single directory of JSON files to SQLite.
 */
function migrateDirectory(
  dirPath: string,
  tableName: string,
  indexedFields: string[]
): MigrationStats {
  const stats: MigrationStats = { table: tableName, migrated: 0, errors: 0 };
  const db = getDatabase();

  if (!fs.existsSync(dirPath)) {
    console.log(`  Directory not found: ${dirPath} (skipping)`);
    return stats;
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  console.log(`  Found ${files.length} JSON files in ${tableName}`);

  // Build insert statement with indexed fields
  const columns = ["id", "data", "updated_at", ...indexedFields];
  const placeholders = columns.map(() => "?").join(", ");
  const conflictUpdates = indexedFields.length > 0
    ? `, ${indexedFields.map((f) => `${f} = excluded.${f}`).join(", ")}`
    : "";

  const sql = `
    INSERT INTO ${tableName} (${columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
      ${conflictUpdates}
  `;

  const stmt = db.prepare(sql);
  const now = new Date().toISOString();

  // Use transaction for atomic batch insert
  const insertMany = db.transaction((entities: Array<{ id: string; data: string; values: (string | null)[] }>) => {
    for (const entity of entities) {
      try {
        stmt.run(entity.id, entity.data, now, ...entity.values);
        stats.migrated++;
      } catch (err) {
        console.error(`    Error inserting ${entity.id}:`, err);
        stats.errors++;
      }
    }
  });

  // Batch read and insert
  const batchSize = 500;
  const batch: Array<{ id: string; data: string; values: (string | null)[] }> = [];

  for (const file of files) {
    try {
      const filePath = path.join(dirPath, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const entity = JSON.parse(content, dateReviver) as Record<string, unknown>;

      if (!entity.id) {
        console.error(`    Missing id in ${file}`);
        stats.errors++;
        continue;
      }

      batch.push({
        id: entity.id as string,
        data: JSON.stringify(entity),
        values: indexedFields.map((f) => getFieldValue(entity, f)),
      });

      if (batch.length >= batchSize) {
        insertMany(batch);
        batch.length = 0;
        process.stdout.write(`    Migrated ${stats.migrated} / ${files.length}\r`);
      }
    } catch (err) {
      console.error(`    Error reading ${file}:`, err);
      stats.errors++;
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    insertMany(batch);
  }

  console.log(`    Migrated ${stats.migrated} / ${files.length} (${stats.errors} errors)`);
  return stats;
}

/**
 * Run full migration.
 */
async function migrate(): Promise<void> {
  console.log("Starting JSON → SQLite migration...\n");

  const allStats: MigrationStats[] = [];

  // Documents
  console.log("Migrating documents...");
  allStats.push(
    migrateDirectory(STORAGE_DIRS.documents, "documents", [
      "email_id",
      "attachment_path",
      "calendar_event_id",
      "source_type",
      "account",
      "date",
      "classification",
      "archived_at",
      "processed_at",
    ])
  );

  // Attachment processing
  console.log("\nMigrating attachment_processing...");
  allStats.push(
    migrateDirectory(STORAGE_DIRS.attachmentProcessing, "attachment_processing", [
      "attachment_path",
      "email_id",
      "account",
      "status",
    ])
  );

  // Archive rules
  console.log("\nMigrating archive_rules...");
  allStats.push(
    migrateDirectory(STORAGE_DIRS.archiveRules, "archive_rules", ["name", "enabled"])
  );

  // Claims
  console.log("\nMigrating claims...");
  allStats.push(
    migrateDirectory(STORAGE_DIRS.claims, "claims", [
      "cigna_claim_id",
      "status",
      "archived_at",
    ])
  );

  // Draft claims
  console.log("\nMigrating draft_claims...");
  allStats.push(
    migrateDirectory(STORAGE_DIRS.draftClaims, "draft_claims", ["status", "archived_at"])
  );

  // Assignments
  console.log("\nMigrating assignments...");
  allStats.push(
    migrateDirectory(STORAGE_DIRS.assignments, "assignments", [
      "document_id",
      "claim_id",
      "status",
    ])
  );

  // Patients
  console.log("\nMigrating patients...");
  allStats.push(migrateDirectory(STORAGE_DIRS.patients, "patients", ["name"]));

  // Illnesses
  console.log("\nMigrating illnesses...");
  allStats.push(
    migrateDirectory(STORAGE_DIRS.illnesses, "illnesses", ["patient_id", "name"])
  );

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("Migration Summary:");
  console.log("=".repeat(50));

  let totalMigrated = 0;
  let totalErrors = 0;

  for (const stat of allStats) {
    console.log(`  ${stat.table}: ${stat.migrated} migrated, ${stat.errors} errors`);
    totalMigrated += stat.migrated;
    totalErrors += stat.errors;
  }

  console.log("-".repeat(50));
  console.log(`  TOTAL: ${totalMigrated} migrated, ${totalErrors} errors`);
  console.log("=".repeat(50));

  closeDatabase();

  if (totalErrors > 0) {
    console.log("\n⚠️  Migration completed with errors. Review above.");
    process.exit(1);
  } else {
    console.log("\n✅ Migration completed successfully!");
    console.log("\nTo switch to SQLite backend, set: STORAGE_BACKEND=sqlite");
  }
}

// Run migration
migrate().catch((err) => {
  console.error("Migration failed:", err);
  closeDatabase();
  process.exit(1);
});
