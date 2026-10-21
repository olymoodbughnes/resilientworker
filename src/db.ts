import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://resilient:resilient@localhost:5432/resilientworker";

export const pool = new Pool({ connectionString });

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id BIGSERIAL PRIMARY KEY,
      payload JSONB NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      dead_letter BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_pending
      ON tasks (created_at)
      WHERE status = 'pending' AND dead_letter = FALSE;
  `);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
