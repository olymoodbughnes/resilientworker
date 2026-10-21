import "dotenv/config";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { closeDb, ensureSchema, pool } from "../src/db";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  await ensureSchema();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE tasks RESTART IDENTITY");
});

afterAll(async () => {
  await closeDb();
});
