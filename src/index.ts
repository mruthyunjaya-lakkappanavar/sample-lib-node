/**
 * @httpkit/client — A typed HTTP client with retry and timeout support.
 *
 * Zero external dependencies. Works across Node.js 18, 20, and 22
 * on Linux, macOS, and Windows.
 *
 * @example
 * ```typescript
 * import { HttpClient } from '@httpkit/client';
 *
 * const client = new HttpClient({
 *   baseURL: 'https://api.example.com',
 *   timeout: 5000,
 *   retries: 3,
 * });
 *
 * const response = await client.get<User[]>('/users');
 * console.log(response.data);
 * ```
 *
 * @packageDocumentation
 */

export { HttpClient } from "./client";
export { withRetry, calculateDelay, DEFAULT_RETRY_CONFIG } from "./retry";
export {
  ClientConfig,
  HttpError,
  HttpResponse,
  RequestOptions,
  RetryConfig,
} from "./types";
