type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitOpenError extends Error {
  constructor() {
    super("Circuit breaker is OPEN");
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private openedAt = 0;

  constructor(
    private threshold = 3,
    private cooldown = 5000
  ) {}

  async execute<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt < this.cooldown) {
        throw new CircuitOpenError();
      }

      this.state = "HALF_OPEN";
    }

    try {
      const result = await action();

      this.failures = 0;
      this.state = "CLOSED";

      return result;
    } catch (error) {
      this.failures++;

      if (
        this.failures >= this.threshold ||
        this.state === "HALF_OPEN"
      ) {
        this.state = "OPEN";
        this.openedAt = Date.now();
        console.log("Circuit breaker OPENED");
      }

      throw error;
    }
  }

  getStatus(): CircuitState {
    return this.state;
  }
}
