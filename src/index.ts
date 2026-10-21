import { TaskQueue } from "./queue";
import { Worker } from "./worker";
import type { EmailPayload } from "./services/notification";

async function main() {
  const queue = new TaskQueue<EmailPayload>();

  queue.add({
    to: "customer@example.com",
    subject: "Order confirmation",
  });

  queue.add({
    to: "customer2@example.com",
    subject: "Your order has shipped",
  });

  const worker = new Worker(queue);

  console.log("Before:", queue.completionStatus);

  await worker.processAll();

  console.log("After:", queue.completionStatus);
  console.log("Dead-letter queue:", queue.getDeadLetters());
  worker.getMetrics().logSummary();
}

main().catch(console.error);
