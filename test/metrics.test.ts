import { describe, expect, it } from "vitest";
import { Metrics } from "../src/metrics";

describe("Metrics", () => {
  it("tracks successes, failures, retries, and circuit rejections separately", () => {
    const metrics = new Metrics();

    metrics.recordSuccess(100);
    metrics.recordFailure(200);
    metrics.recordRetry();
    metrics.recordRetry();
    metrics.recordCircuitRejection();

    expect(metrics.getSnapshot()).toEqual({
      successes: 1,
      failures: 1,
      retries: 2,
      circuitRejections: 1,
      totalProcessingTimeMs: 300,
      averageProcessingTimeMs: 150,
    });
  });
});
