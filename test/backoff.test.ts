import { describe, expect, it } from "vitest";
import { calculateBackoff } from "../src/backoff";

describe("calculateBackoff", () => {
  it("doubles delay each attempt starting at 1s", () => {
    expect(calculateBackoff(1)).toBe(1000);
    expect(calculateBackoff(2)).toBe(2000);
    expect(calculateBackoff(3)).toBe(4000);
    expect(calculateBackoff(4)).toBe(8000);
  });
});
