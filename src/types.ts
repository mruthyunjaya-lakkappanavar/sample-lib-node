/**
 * Type definitions for the HTTP client library.
 *
 * Provides strongly-typed interfaces for request configuration,
 * response handling, and error representation.
 */

/** Configuration for creating an HttpClient instance. */
export interface ClientConfig {
  /** Base URL prepended to all request paths (e.g., "https://api.example.com") */
  baseURL?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Default headers sent with every request */
  headers?: Record<string, string>;
  /** Number of retry attempts for retryable errors (default: 3) */
  retries?: number;
  /** Base delay between retries in ms (default: 1000). Exponential backoff applied. */
  retryDelay?: number;
  /** Maximum delay between retries in ms (default: 10000) */
  maxDelay?: number;
  /** HTTP status codes that trigger a retry (default: [408, 429, 500, 502, 503, 504]) */
  retryableStatuses?: number[];
}

/** Per-request options that override client defaults. */
export interface RequestOptions {
  /** Override timeout for this request */
  timeout?: number;
  /** Additional headers for this request (merged with defaults) */
  headers?: Record<string, string>;
  /** Override retry count for this request */
  retries?: number;
  /** Query string parameters */
  params?: Record<string, string | number | boolean>;
}

/** Typed HTTP response. */
export interface HttpResponse<T = unknown> {
  /** Parsed response body */
  data: T;
  /** HTTP status code */
  status: number;
  /** HTTP status message */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
}

/** Error thrown on failed HTTP requests. */
export class HttpError extends Error {
  /** HTTP status code (0 if no response received) */
  public readonly status: number;
  /** Response body if available */
  public readonly responseBody: string;
  /** Whether this error is retryable */
  public readonly isRetryable: boolean;
  /** Number of attempts made */
  public readonly attempts: number;

  constructor(
    message: string,
    status: number,
    responseBody: string = "",
    isRetryable: boolean = false,
    attempts: number = 1,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.responseBody = responseBody;
    this.isRetryable = isRetryable;
    this.attempts = attempts;
  }
}

/** @internal Retry configuration resolved from ClientConfig. */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryableStatuses: number[];
}
