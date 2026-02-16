/**
 * HttpClient — A typed HTTP client with retry, timeout, and cross-platform support.
 *
 * Uses Node.js built-in `http`/`https` modules (zero external dependencies),
 * making it ideal for testing across Node 18/20/22 on all operating systems.
 */

import http from "node:http";
import https from "node:https";
import { URL, URLSearchParams } from "node:url";
import {
  ClientConfig,
  HttpError,
  HttpResponse,
  RequestOptions,
  RetryConfig,
} from "./types";
import { DEFAULT_RETRY_CONFIG, withRetry } from "./retry";

export class HttpClient {
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly retryConfig: RetryConfig;

  constructor(config: ClientConfig = {}) {
    this.baseURL = (config.baseURL || "").replace(/\/+$/, "");
    this.timeout = config.timeout ?? 30000;
    this.defaultHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...config.headers,
    };
    this.retryConfig = {
      maxRetries: config.retries ?? DEFAULT_RETRY_CONFIG.maxRetries,
      baseDelay: config.retryDelay ?? DEFAULT_RETRY_CONFIG.baseDelay,
      maxDelay: config.maxDelay ?? DEFAULT_RETRY_CONFIG.maxDelay,
      retryableStatuses:
        config.retryableStatuses ?? DEFAULT_RETRY_CONFIG.retryableStatuses,
    };
  }

  /**
   * Perform a GET request.
   */
  async get<T = unknown>(
    path: string,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>("GET", path, undefined, options);
  }

  /**
   * Perform a POST request.
   */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>("POST", path, body, options);
  }

  /**
   * Perform a PUT request.
   */
  async put<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>("PUT", path, body, options);
  }

  /**
   * Perform a PATCH request.
   */
  async patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>("PATCH", path, body, options);
  }

  /**
   * Perform a DELETE request.
   */
  async delete<T = unknown>(
    path: string,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return this.request<T>("DELETE", path, undefined, options);
  }

  /**
   * Core request method with retry logic.
   *
   * @internal
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    const maxRetries = options?.retries ?? this.retryConfig.maxRetries;
    const retryConfig: RetryConfig = {
      ...this.retryConfig,
      maxRetries,
    };

    const shouldRetry = (error: unknown): boolean => {
      if (error instanceof HttpError) {
        return this.retryConfig.retryableStatuses.includes(error.status);
      }
      // Retry on network errors (ECONNRESET, ETIMEDOUT, etc.)
      if (error instanceof Error) {
        const code = (error as NodeJS.ErrnoException).code;
        return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"].includes(
          code || "",
        );
      }
      return false;
    };

    try {
      const { result } = await withRetry(
        () => this.executeRequest<T>(method, path, body, options),
        retryConfig,
        shouldRetry,
      );
      return result;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(
        `Request failed: ${method} ${path} — ${(error as Error).message}`,
        0,
        "",
        false,
        maxRetries + 1,
      );
    }
  }

  /**
   * Execute a single HTTP request (no retry).
   *
   * @internal
   */
  private executeRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>> {
    return new Promise<HttpResponse<T>>((resolve, reject) => {
      // Build URL
      let fullUrl: string;
      if (path.startsWith("http://") || path.startsWith("https://")) {
        fullUrl = path;
      } else {
        fullUrl = `${this.baseURL}${path.startsWith("/") ? "" : "/"}${path}`;
      }

      // Append query params
      if (options?.params) {
        const url = new URL(fullUrl);
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options.params)) {
          params.set(key, String(value));
        }
        url.search = params.toString();
        fullUrl = url.toString();
      }

      const parsedUrl = new URL(fullUrl);
      const isHttps = parsedUrl.protocol === "https:";
      const transport = isHttps ? https : http;

      // Merge headers
      const headers: Record<string, string> = {
        ...this.defaultHeaders,
        ...options?.headers,
      };

      // Serialize body
      let bodyData: string | undefined;
      if (body !== undefined) {
        bodyData = typeof body === "string" ? body : JSON.stringify(body);
        headers["Content-Length"] = Buffer.byteLength(bodyData).toString();
      }

      const requestOptions: http.RequestOptions = {
        method,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        headers,
        timeout: options?.timeout ?? this.timeout,
      };

      const req = transport.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          const status = res.statusCode || 0;
          const statusText = res.statusMessage || "";
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value) {
              responseHeaders[key] = Array.isArray(value)
                ? value.join(", ")
                : value;
            }
          }

          // Parse body
          let data: T;
          try {
            data = JSON.parse(rawBody) as T;
          } catch {
            data = rawBody as unknown as T;
          }

          // Check for error status codes
          if (status >= 400) {
            const isRetryable = this.retryConfig.retryableStatuses.includes(status);
            reject(
              new HttpError(
                `HTTP ${status}: ${statusText} — ${method} ${path}`,
                status,
                rawBody,
                isRetryable,
              ),
            );
            return;
          }

          resolve({
            data,
            status,
            statusText,
            headers: responseHeaders,
          });
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(
          new HttpError(
            `Request timeout after ${requestOptions.timeout}ms: ${method} ${path}`,
            0,
            "",
            true,
          ),
        );
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  }
}
