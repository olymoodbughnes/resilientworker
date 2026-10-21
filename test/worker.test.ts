import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskQueue } from "../src/queue";
import type { EmailPayload } from "../src/services/notification";

vi.mock("../src/services/notification", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("../src/backoff", async () => {
  const actual = await vi.importActual<typeof import("../src/backoff")>(
    "../src/backoff",
  );
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

import { sendEmail } from "../src/services/notification";
import { Worker } from "../src/worker";

describe("Worker", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
  });

  it("completes a task after a successful send", async () => {
    vi.mocked(sendEmail).mockResolvedValue(undefined);

    const queue = new TaskQueue<EmailPayload>();
    await queue.add({ to: "a@example.com", subject: "hi" });

    const worker = new Worker(queue);
    const processed = await worker.processNext();

    expect(processed).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();

    const status = await queue.getCompletionStatus();
    expect(status.completed).toBe(1);
    expect(worker.getMetrics().getSnapshot().successes).toBe(1);
  });

  it("moves exhausted tasks to the dead-letter queue with attempt count", async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error("always down"));

    const queue = new TaskQueue<EmailPayload>();
    await queue.add({ to: "b@example.com", subject: "bye" });

    const worker = new Worker(queue);
    await worker.processNext();

    const dead = await queue.getDeadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0]?.attempts).toBe(3);

    const metrics = worker.getMetrics().getSnapshot();
    expect(metrics.failures).toBe(1);
    expect(metrics.retries).toBe(2);
  });

  it("returns false when the queue is empty", async () => {
    const queue = new TaskQueue<EmailPayload>();
    const worker = new Worker(queue);

    await expect(worker.processNext()).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
