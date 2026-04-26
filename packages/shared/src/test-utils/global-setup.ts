/**
 * Vitest global setup for integration tests.
 *
 * Creates a dedicated test database (ironclaw_test) on the existing Postgres
 * instance, runs migrations, and drops it on teardown. If Postgres is not
 * running, prints a helpful message and exits (tests will be skipped).
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const POSTGRES_HOST = process.env["POSTGRES_HOST"] ?? "localhost";
const POSTGRES_PORT = parseInt(process.env["POSTGRES_PORT"] ?? "5433", 10);
const POSTGRES_USER = process.env["POSTGRES_USER"] ?? "ironclaw";
const POSTGRES_PASSWORD = process.env["POSTGRES_PASSWORD"] ?? "dev_password";
const TEST_DB_NAME = "ironclaw_test";

const adminUrl = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/postgres`;
const testDbUrl = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${TEST_DB_NAME}`;

// Set the DATABASE_URL for the test process so connection.ts picks it up
process.env["DATABASE_URL"] = testDbUrl;

export async function setup() {
  // 1. Connect to default 'postgres' DB to create the test database
  let adminSql: ReturnType<typeof postgres>;
  try {
    adminSql = postgres(adminUrl, { max: 1 });
    await adminSql`SELECT 1`; // connectivity check
  } catch (err) {
    throw new Error(
      `Cannot connect to Postgres. Integration tests require Docker services running.\n` +
      `   Start them with: docker compose -f docker-compose.dev.yml up -d\n` +
      `   Connection: ${adminUrl}\n` +
      `   Original error: ${err instanceof Error ? err.message : err}`,
    );
  }

  // 2. Drop and recreate test database for a clean slate
  try {
    // Terminate existing connections to test DB
    await adminSql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${TEST_DB_NAME} AND pid <> pg_backend_pid()
    `;
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await adminSql.unsafe(`CREATE DATABASE ${TEST_DB_NAME} OWNER ${POSTGRES_USER}`);
  } finally {
    await adminSql.end();
  }

  // 3. Enable pgvector extension on test DB
  const testSql = postgres(testDbUrl, { max: 1 });
  try {
    await testSql`CREATE EXTENSION IF NOT EXISTS vector`;
  } finally {
    await testSql.end();
  }

  // 4. Run migrations on test DB
  const migrationSql = postgres(testDbUrl, { max: 1 });
  const migrationDb = drizzle(migrationSql);
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = join(currentDir, "..", "db", "migrations");

  try {
    await migrate(migrationDb, { migrationsFolder });
  } finally {
    await migrationSql.end();
  }

  console.log(`✓ Integration test database "${TEST_DB_NAME}" ready`);
}

export async function teardown() {
  // Drop the test database
  const adminSql = postgres(adminUrl, { max: 1 });
  try {
    await adminSql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${TEST_DB_NAME} AND pid <> pg_backend_pid()
    `;
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    console.log(`✓ Integration test database "${TEST_DB_NAME}" dropped`);
  } finally {
    await adminSql.end();
  }
}
