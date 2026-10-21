import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "../src/circuitbreaker";

describe("CircuitBreaker", () => {
  it("opens after reaching the failure threshold", async () => {
    const breaker = new CircuitBreaker(3, 5_000);
    const fail = vi.fn().mockRejectedValue(new Error("down"));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow("down");
    }

    expect(breaker.getStatus()).toBe("OPEN");
    await expect(breaker.execute(fail)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("allows a half-open probe after the cooldown", async () => {
    vi.useFakeTimers();
    const breaker = new CircuitBreaker(1, 1_000);
    const fail = vi.fn().mockRejectedValue(new Error("down"));
    const succeed = vi.fn().mockResolvedValue("ok");

    await expect(breaker.execute(fail)).rejects.toThrow("down");
    expect(breaker.getStatus()).toBe("OPEN");

    vi.advanceTimersByTime(1_000);

    await expect(breaker.execute(succeed)).resolves.toBe("ok");
    expect(breaker.getStatus()).toBe("CLOSED");

    vi.useRealTimers();
  });
});
