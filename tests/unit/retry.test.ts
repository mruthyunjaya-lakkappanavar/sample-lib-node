/**
 * Unit tests for retry utility.
 */

import { withRetry, calculateDelay, DEFAULT_RETRY_CONFIG } from "../../src";
import { RetryConfig } from "../../src/types";

describe("withRetry", () => {
  const config: RetryConfig = {
    maxRetries: 3,
    baseDelay: 10, // Short delays for tests
    maxDelay: 100,
    retryableStatuses: [500, 503],
  };

  it("should return result on first success", async () => {
    const fn = jest.fn().mockResolvedValue("success");
    const shouldRetry = jest.fn().mockReturnValue(true);

    const { result, attempts } = await withRetry(fn, config, shouldRetry);

    expect(result).toBe("success");
    expect(attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).not.toHaveBeenCalled();
  });

  it("should retry on failure and succeed", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");
    const shouldRetry = jest.fn().mockReturnValue(true);

    const { result, attempts } = await withRetry(fn, config, shouldRetry);

    expect(result).toBe("success");
    expect(attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw after exhausting all retries", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("always fails"));
    const shouldRetry = jest.fn().mockReturnValue(true);

    await expect(withRetry(fn, config, shouldRetry)).rejects.toThrow(
      "always fails",
    );
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it("should not retry when shouldRetry returns false", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("non-retryable"));
    const shouldRetry = jest.fn().mockReturnValue(false);

    await expect(withRetry(fn, config, shouldRetry)).rejects.toThrow(
      "non-retryable",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should pass error and attempt to shouldRetry", async () => {
    const error = new Error("test error");
    const fn = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");
    const shouldRetry = jest.fn().mockReturnValue(true);

    await withRetry(fn, config, shouldRetry);

    expect(shouldRetry).toHaveBeenCalledWith(error, 1);
  });
});

describe("calculateDelay", () => {
  const config: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    retryableStatuses: [],
  };

  it("should increase delay with attempt number", () => {
    // Run multiple times to account for jitter randomness
    const delays1: number[] = [];
    const delays3: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays1.push(calculateDelay(1, config));
      delays3.push(calculateDelay(3, config));
    }
    const avg1 = delays1.reduce((a, b) => a + b) / delays1.length;
    const avg3 = delays3.reduce((a, b) => a + b) / delays3.length;

    // Average delay for attempt 3 should be higher than attempt 1
    expect(avg3).toBeGreaterThan(avg1);
  });

  it("should never exceed maxDelay", () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      const delay = calculateDelay(attempt, config);
      expect(delay).toBeLessThanOrEqual(config.maxDelay);
    }
  });

  it("should always be at least baseDelay", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = calculateDelay(attempt, config);
      expect(delay).toBeGreaterThanOrEqual(config.baseDelay);
    }
  });
});

describe("DEFAULT_RETRY_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.baseDelay).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(10000);
    expect(DEFAULT_RETRY_CONFIG.retryableStatuses).toContain(500);
    expect(DEFAULT_RETRY_CONFIG.retryableStatuses).toContain(503);
    expect(DEFAULT_RETRY_CONFIG.retryableStatuses).toContain(429);
  });
});
