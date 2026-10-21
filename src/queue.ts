import { pool } from "./db";

export type TaskStatus = "pending" | "processing" | "completed" | "failed";

export type Task<T = unknown> = {
  id: string;
  payload: T;
  status: TaskStatus;
  attempts: number;
  createdAt: number;
};

export type CompletionStatus = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
};

type TaskRow = {
  id: string;
  payload: unknown;
  status: TaskStatus;
  attempts: number;
  created_at: string;
};

function log(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "test") {
    console.log(...args);
  }
}

function mapRow<T>(row: TaskRow): Task<T> {
  return {
    id: String(row.id),
    payload: row.payload as T,
    status: row.status,
    attempts: row.attempts,
    createdAt: Number(row.created_at),
  };
}

export class TaskQueue<T = unknown> {
  /** Snapshot of how many active (non-dead-letter) tasks are in each status. */
  async getCompletionStatus(): Promise<CompletionStatus> {
    const { rows } = await pool.query<{ status: TaskStatus; count: string }>(`
      SELECT status, COUNT(*)::text AS count
      FROM tasks
      WHERE dead_letter = FALSE
      GROUP BY status
    `);

    const status: CompletionStatus = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: 0,
    };

    for (const row of rows) {
      const key = row.status as TaskStatus;
      const count = Number(row.count);
      status[key] = count;
      status.total += count;
    }

    return status;
  }

  /** Add a task to the end of the queue. */
  async add(payload: T): Promise<Task<T>> {
    const now = Date.now();
    const { rows } = await pool.query<TaskRow>(
      `
      INSERT INTO tasks (payload, status, attempts, created_at, updated_at, dead_letter)
      VALUES ($1::jsonb, 'pending', 0, $2, $2, FALSE)
      RETURNING id::text, payload, status, attempts, created_at::text
      `,
      [JSON.stringify(payload), now],
    );

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to insert task");
    }

    const task = mapRow<T>(row);
    log(`[postgres] inserted task ${task.id}`);
    return task;
  }

  /**
   * Take the oldest pending task and mark it as processing.
   * Attempt counting is handled separately via recordAttempt().
   */
  async claimOldest(): Promise<Task<T> | undefined> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const { rows } = await client.query<TaskRow>(`
        SELECT id::text, payload, status, attempts, created_at::text
        FROM tasks
        WHERE status = 'pending' AND dead_letter = FALSE
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);

      const row = rows[0];
      if (!row) {
        await client.query("COMMIT");
        return undefined;
      }

      const { rows: updated } = await client.query<TaskRow>(
        `
        UPDATE tasks
        SET status = 'processing', updated_at = $2
        WHERE id = $1::bigint
        RETURNING id::text, payload, status, attempts, created_at::text
        `,
        [row.id, Date.now()],
      );

      await client.query("COMMIT");

      const claimed = updated[0];
      if (!claimed) {
        return undefined;
      }

      const task = mapRow<T>(claimed);
      log(
        `[postgres] claimed task ${task.id} (status=${task.status}, attempts=${task.attempts})`
      );
      return task;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Persist one processing attempt for a claimed task. */
  async recordAttempt(id: string): Promise<Task<T> | undefined> {
    const { rows } = await pool.query<TaskRow>(
      `
      UPDATE tasks
      SET attempts = attempts + 1, updated_at = $2
      WHERE id = $1::bigint AND status = 'processing' AND dead_letter = FALSE
      RETURNING id::text, payload, status, attempts, created_at::text
      `,
      [id, Date.now()],
    );

    const row = rows[0];
    if (!row) {
      return undefined;
    }

    const task = mapRow<T>(row);
    log(`[postgres] task ${task.id} attempts → ${task.attempts}`);
    return task;
  }

  /**
   * Re-queue processing tasks that look abandoned after a worker crash.
   * Returns how many tasks were recovered.
   */
  async recoverStale(staleAfterMs: number): Promise<number> {
    const cutoff = Date.now() - staleAfterMs;
    const now = Date.now();

    const { rows } = await pool.query<{ id: string }>(
      `
      UPDATE tasks
      SET status = 'pending', updated_at = $1
      WHERE status = 'processing'
        AND dead_letter = FALSE
        AND updated_at <= $2
      RETURNING id::text
      `,
      [now, cutoff],
    );

    if (rows.length > 0) {
      log(`[postgres] recovered ${rows.length} stale processing task(s)`);
    }

    return rows.length;
  }

  /** Snapshot of all active tasks, oldest first. Returned tasks are frozen copies. */
  async getAll(): Promise<ReadonlyArray<Readonly<Task<T>>>> {
    const { rows } = await pool.query<TaskRow>(`
      SELECT id::text, payload, status, attempts, created_at::text
      FROM tasks
      WHERE dead_letter = FALSE
      ORDER BY created_at ASC, id ASC
    `);

    return rows.map((row) => Object.freeze(mapRow<T>(row)));
  }

  /** Mark a processing task as completed. Ignores tasks that are not processing. */
  async complete(id: string): Promise<Task<T> | undefined> {
    const { rows } = await pool.query<TaskRow>(
      `
      UPDATE tasks
      SET status = 'completed', updated_at = $2
      WHERE id = $1::bigint AND status = 'processing' AND dead_letter = FALSE
      RETURNING id::text, payload, status, attempts, created_at::text
      `,
      [id, Date.now()],
    );

    const row = rows[0];
    if (!row) {
      return undefined;
    }

    const task = mapRow<T>(row);
    log(`[postgres] completed task ${task.id}`);
    return task;
  }

  /** Mark a processing task as failed. Ignores tasks that are not processing. */
  async fail(id: string): Promise<Task<T> | undefined> {
    const { rows } = await pool.query<TaskRow>(
      `
      UPDATE tasks
      SET status = 'failed', updated_at = $2
      WHERE id = $1::bigint AND status = 'processing' AND dead_letter = FALSE
      RETURNING id::text, payload, status, attempts, created_at::text
      `,
      [id, Date.now()],
    );

    const row = rows[0];
    return row ? mapRow<T>(row) : undefined;
  }

  /**
   * Move a processing or failed task into the dead-letter collection.
   */
  async moveToDeadLetter(id: string): Promise<Task<T> | undefined> {
    const { rows } = await pool.query<TaskRow>(
      `
      UPDATE tasks
      SET status = 'failed', dead_letter = TRUE, updated_at = $2
      WHERE id = $1::bigint
        AND dead_letter = FALSE
        AND status IN ('processing', 'failed')
      RETURNING id::text, payload, status, attempts, created_at::text
      `,
      [id, Date.now()],
    );

    const row = rows[0];
    if (!row) {
      return undefined;
    }

    const task = mapRow<T>(row);
    log(
      `[postgres] moved task ${task.id} to dead-letter (attempts=${task.attempts})`
    );
    return task;
  }

  /** Snapshot of dead-letter tasks. Returned tasks are frozen copies. */
  async getDeadLetters(): Promise<ReadonlyArray<Readonly<Task<T>>>> {
    const { rows } = await pool.query<TaskRow>(`
      SELECT id::text, payload, status, attempts, created_at::text
      FROM tasks
      WHERE dead_letter = TRUE
      ORDER BY created_at ASC, id ASC
    `);

    return rows.map((row) => Object.freeze(mapRow<T>(row)));
  }
}
