import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://resilient:resilient@localhost:5432/resilientworker";

export const pool = new Pool({
  connectionString,
  // Allow concurrent claim tests / workers to hold many connections at once.
  max: Number(process.env.PG_POOL_MAX ?? 30),
});

function describeConnection(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export async function ensureSchema(): Promise<void> {
  const { rows } = await pool.query<{
    current_database: string;
    inet_server_addr: string | null;
  }>(`
    SELECT current_database(), inet_server_addr()::text
  `);

  const info = rows[0];
  console.log(
    `[postgres] connected to ${describeConnection(connectionString)}` +
      (info ? ` (db=${info.current_database})` : "")
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL DEFAULT 0,
      dead_letter BOOLEAN NOT NULL DEFAULT FALSE
    );

    ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_tasks_pending
      ON tasks (created_at)
      WHERE status = 'pending' AND dead_letter = FALSE;

    CREATE INDEX IF NOT EXISTS idx_tasks_stale_processing
      ON tasks (updated_at)
      WHERE status = 'processing' AND dead_letter = FALSE;
  `);

  console.log("[postgres] tasks table ready");
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
