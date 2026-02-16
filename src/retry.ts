/**
 * Retry utility with exponential backoff and jitter.
 *
 * Implements the "decorrelated jitter" algorithm recommended by AWS:
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */

import { RetryConfig } from "./types";

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

/**
 * Execute an async function with retry logic and exponential backoff.
 *
 * @param fn - The async function to retry
 * @param config - Retry configuration
 * @param shouldRetry - Predicate to determine if an error is retryable
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  shouldRetry: (error: unknown, attempt: number) => boolean,
): Promise<{ result: T; attempts: number }> {
  let lastError: unknown;
  const totalAttempts = config.maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (error) {
      lastError = error;

      if (attempt >= totalAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delay = calculateDelay(attempt, config);
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Calculate delay with exponential backoff + decorrelated jitter.
 *
 * @internal
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential: baseDelay * 2^(attempt-1)
  const exponential = config.baseDelay * Math.pow(2, attempt - 1);
  // Add jitter: random value between 0 and exponential delay
  const jitter = Math.random() * exponential;
  // Cap at maxDelay
  return Math.min(jitter + config.baseDelay, config.maxDelay);
}

/**
 * Sleep for a given number of milliseconds.
 *
 * @internal - exported for testing
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
