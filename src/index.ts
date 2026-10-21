import "dotenv/config";
import { closeDb, ensureSchema } from "./db";
import { TaskQueue } from "./queue";
import { Worker } from "./worker";
import type { EmailPayload } from "./services/notification";

async function main() {
  await ensureSchema();

  const queue = new TaskQueue<EmailPayload>();

  await queue.add({
    to: "customer@example.com",
    subject: "Order confirmation",
  });

  await queue.add({
    to: "customer2@example.com",
    subject: "Your order has shipped",
  });

  const worker = new Worker(queue);

  console.log("Before:", await queue.getCompletionStatus());

  await worker.processAll();

  console.log("After:", await queue.getCompletionStatus());
  console.log("Dead-letter queue:", await queue.getDeadLetters());
  worker.getMetrics().logSummary();
}

main()
  .catch(console.error)
  .finally(() => closeDb());
