export type MetricsSnapshot = {
  successes: number;
  failures: number;
  retries: number;
  totalProcessingTimeMs: number;
  averageProcessingTimeMs: number;
};

export class Metrics {
  private successes = 0;
  private failures = 0;
  private retries = 0;
  private totalProcessingTimeMs = 0;

  recordSuccess(processingTimeMs: number): void {
    this.successes++;
    this.totalProcessingTimeMs += processingTimeMs;
    console.log(
      `[metrics] success (+1) processingTime=${processingTimeMs}ms`
    );
  }

  recordFailure(processingTimeMs: number): void {
    this.failures++;
    this.totalProcessingTimeMs += processingTimeMs;
    console.log(
      `[metrics] failure (+1) processingTime=${processingTimeMs}ms`
    );
  }

  recordRetry(): void {
    this.retries++;
    console.log(`[metrics] retry (+1) totalRetries=${this.retries}`);
  }

  getSnapshot(): MetricsSnapshot {
    const finished = this.successes + this.failures;

    return {
      successes: this.successes,
      failures: this.failures,
      retries: this.retries,
      totalProcessingTimeMs: this.totalProcessingTimeMs,
      averageProcessingTimeMs:
        finished === 0
          ? 0
          : Math.round(this.totalProcessingTimeMs / finished),
    };
  }

  logSummary(): void {
    console.log("[metrics] summary:", this.getSnapshot());
  }
}
