import { sleep, calculateBackoff } from "./backoff";
import { CircuitBreaker, CircuitOpenError } from "./circuitbreaker";
import { Metrics } from "./metrics";
import { TaskQueue } from "./queue";
import {
  sendEmail,
  type EmailPayload,
} from "./services/notification";

export class Worker {
  private readonly maxAttempts = 3;
  private readonly circuitCooldown = 5000;
  private readonly circuit = new CircuitBreaker(3, this.circuitCooldown);
  private readonly metrics = new Metrics();

  constructor(private queue: TaskQueue<EmailPayload>) {}

  getMetrics(): Metrics {
    return this.metrics;
  }

  async processNext(): Promise<boolean> {
    const task = await this.queue.claimOldest();

    if (!task) {
      console.log("No pending tasks.");
      return false;
    }

    console.log(`Processing task ${task.id}...`);
    const startedAt = Date.now();

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.queue.recordAttempt(task.id);
      console.log(`Attempt ${attempt}/${this.maxAttempts}`);

      try {
        await this.circuit.execute(() => sendEmail(task.payload));

        await this.queue.complete(task.id);
        this.metrics.recordSuccess(Date.now() - startedAt);
        console.log(`Task ${task.id} completed.`);
        return true;
      } catch (error) {
        const blockedByCircuit = error instanceof CircuitOpenError;

        console.error(
          `Task ${task.id} failed on attempt ${attempt}:`,
          error instanceof Error ? error.message : error
        );

        if (attempt === this.maxAttempts) {
          await this.queue.moveToDeadLetter(task.id);
          this.metrics.recordFailure(Date.now() - startedAt);
          console.error(`Task ${task.id} moved to dead-letter queue.`);
        }

        if (attempt < this.maxAttempts) {
          if (blockedByCircuit) {
            this.metrics.recordCircuitRejection();
            console.log(
              `Circuit open, waiting ${this.circuitCooldown}ms before retry...`
            );
            await sleep(this.circuitCooldown);
          } else {
            this.metrics.recordRetry();

            if (this.circuit.getStatus() === "OPEN") {
              console.log(
                `Circuit open, waiting ${this.circuitCooldown}ms before retry...`
              );
              await sleep(this.circuitCooldown);
            } else {
              const delay = calculateBackoff(attempt);
              console.log(`Waiting ${delay}ms before retry...`);
              await sleep(delay);
            }
          }
        }
      }
    }

    return true;
  }

  async processAll(): Promise<void> {
    while (await this.processNext()) {
      // Continue until no pending tasks remain.
    }
  }
}
