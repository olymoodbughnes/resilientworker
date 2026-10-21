import { describe, expect, it } from "vitest";
import { pool } from "../src/db";
import { TaskQueue } from "../src/queue";

describe("TaskQueue", () => {
  it("persists tasks in PostgreSQL and completes them", async () => {
    const queue = new TaskQueue<{ n: number }>();

    const created = await queue.add({ n: 1 });
    expect(created.status).toBe("pending");
    expect(created.attempts).toBe(0);

    const { rows } = await pool.query<{ id: string; status: string }>(
      `SELECT id::text, status FROM tasks WHERE id = $1::bigint`,
      [created.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");

    const claimed = await queue.claimOldest();
    expect(claimed?.id).toBe(created.id);
    expect(claimed?.status).toBe("processing");

    await queue.recordAttempt(created.id);
    await queue.recordAttempt(created.id);

    const completed = await queue.complete(created.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.attempts).toBe(2);

    const status = await queue.getCompletionStatus();
    expect(status).toMatchObject({
      completed: 1,
      pending: 0,
      processing: 0,
      total: 1,
    });
  });

  it("only completes or dead-letters processing tasks", async () => {
    const queue = new TaskQueue<string>();
    const pending = await queue.add("later");

    expect(await queue.complete(pending.id)).toBeUndefined();
    expect(await queue.moveToDeadLetter(pending.id)).toBeUndefined();

    const claimed = await queue.claimOldest();
    expect(claimed?.id).toBe(pending.id);

    await queue.recordAttempt(pending.id);
    const dead = await queue.moveToDeadLetter(pending.id);
    expect(dead?.status).toBe("failed");

    const letters = await queue.getDeadLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0]?.id).toBe(pending.id);
    expect(letters[0]?.attempts).toBe(1);

    const status = await queue.getCompletionStatus();
    expect(status.total).toBe(0);
  });

  it("does not let concurrent Postgres workers claim the same row", async () => {
    const jobCount = 20;
    const workerCount = 20;

    // Guard: this must be a real Postgres backend, not an in-memory stand-in.
    const { rows: versionRows } = await pool.query<{ version: string }>(
      "SELECT version()",
    );
    expect(versionRows[0]?.version).toMatch(/PostgreSQL/i);
    expect(pool.options.max).toBeGreaterThanOrEqual(workerCount);

    const queue = new TaskQueue<{ i: number }>();
    for (let i = 0; i < jobCount; i++) {
      await queue.add({ i });
    }

    // Dedicated clients so claims are not serialized by a small pool.
    // Each worker begins a transaction, then ALL run SELECT ... FOR UPDATE
    // SKIP LOCKED before any commits — proving row locks overlap in Postgres.
    const clients = await Promise.all(
      Array.from({ length: workerCount }, () => pool.connect()),
    );

    try {
      await Promise.all(clients.map((client) => client.query("BEGIN")));

      const selections = await Promise.all(
        clients.map((client) =>
          client.query<{ id: string }>(`
            SELECT id::text
            FROM tasks
            WHERE status = 'pending' AND dead_letter = FALSE
            ORDER BY created_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `),
        ),
      );

      const lockedIds = selections
        .map((result) => result.rows[0]?.id)
        .filter((id): id is string => id !== undefined);

      // Both matter: uniqueness alone would pass if only 5 of 20 claims
      // succeeded with distinct ids. We seeded 20 pending jobs and use 20
      // workers, so every claim must succeed AND all ids must be distinct.
      expect(lockedIds).toHaveLength(jobCount);
      expect(new Set(lockedIds).size).toBe(jobCount);
      expect(selections.every((result) => result.rows.length === 1)).toBe(true);

      // Finish the claim the same way TaskQueue.claimOldest does.
      await Promise.all(
        clients.map(async (client, index) => {
          const id = selections[index]?.rows[0]?.id;
          if (id) {
            await client.query(
              `
              UPDATE tasks
              SET status = 'processing', updated_at = $2
              WHERE id = $1::bigint
              `,
              [id, Date.now()],
            );
          }
          await client.query("COMMIT");
        }),
      );
    } finally {
      for (const client of clients) {
        client.release();
      }
    }

    const status = await queue.getCompletionStatus();
    expect(status.processing).toBe(jobCount);
    expect(status.pending).toBe(0);
  });

  it("TaskQueue.claimOldest also stays unique under parallel pool claims", async () => {
    const jobCount = 20;
    const queue = new TaskQueue<{ i: number }>();

    for (let i = 0; i < jobCount; i++) {
      await queue.add({ i });
    }

    // More callers than jobs, enough pool connections for true overlap.
    const claims = await Promise.all(
      Array.from({ length: jobCount + 5 }, () => queue.claimOldest()),
    );

    const claimed = claims.filter((task) => task !== undefined);
    const ids = claimed.map((task) => task.id);

    // Seeded 20 jobs → exactly 20 successful claims, all distinct;
    // the extra 5 callers must get nothing (not silent duplicates).
    expect(claimed).toHaveLength(jobCount);
    expect(new Set(ids).size).toBe(jobCount);
    expect(claims.filter((task) => task === undefined)).toHaveLength(5);
  });

  it("recovers stale processing tasks after a simulated worker crash", async () => {
    const queue = new TaskQueue<{ kind: string }>();
    await queue.add({ kind: "orphan" });

    const claimed = await queue.claimOldest();
    expect(claimed?.status).toBe("processing");

    // Simulate crash: task stuck in processing, heartbeat/timestamp aged out.
    await pool.query(
      `UPDATE tasks SET updated_at = $1 WHERE id = $2::bigint`,
      [Date.now() - 60_000, claimed!.id],
    );

    // Still processing → not claimable yet.
    expect(await queue.claimOldest()).toBeUndefined();

    const recovered = await queue.recoverStale(30_000);
    expect(recovered).toBe(1);

    const again = await queue.claimOldest();
    expect(again?.id).toBe(claimed!.id);
    expect(again?.status).toBe("processing");
  });

  it("does not recover fresh processing tasks", async () => {
    const queue = new TaskQueue<string>();
    await queue.add("fresh");
    await queue.claimOldest();

    const recovered = await queue.recoverStale(30_000);
    expect(recovered).toBe(0);
    expect(await queue.claimOldest()).toBeUndefined();
  });
});
