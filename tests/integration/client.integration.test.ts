/**
 * Integration tests for HttpClient.
 *
 * Tests the client against real HTTP endpoints to verify end-to-end behavior
 * including retry logic, concurrent requests, and error recovery.
 *
 * These tests run in the "integration" test type for the matrix CI workflow.
 */

import http from "node:http";
import { HttpClient, HttpError } from "../../src";

let server: http.Server;
let baseURL: string;
let requestLog: Array<{ method: string; path: string; timestamp: number }>;

// ── Test Server with stateful behavior ─────────────────────
beforeAll(
  () =>
    new Promise<void>((resolve) => {
      requestLog = [];

      server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost`);
        const path = url.pathname;

        requestLog.push({
          method: req.method || "GET",
          path,
          timestamp: Date.now(),
        });

        // Route: GET /retry-counter — fails first N times, then succeeds
        if (path === "/retry-counter") {
          const failCount = parseInt(
            url.searchParams.get("failCount") || "2",
            10,
          );
          const attempts = requestLog.filter(
            (r) => r.path === "/retry-counter",
          ).length;
          if (attempts <= failCount) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Service Unavailable",
                attempt: attempts,
              }),
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, attempt: attempts }));
          return;
        }

        // Route: GET /rate-limited — returns 429 with Retry-After
        if (path === "/rate-limited") {
          const attempts = requestLog.filter(
            (r) => r.path === "/rate-limited",
          ).length;
          if (attempts <= 1) {
            res.writeHead(429, {
              "Content-Type": "application/json",
              "Retry-After": "1",
            });
            res.end(JSON.stringify({ error: "Rate limited" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // Route: GET /concurrent — echoes request ID
        if (path === "/concurrent") {
          const id = url.searchParams.get("id") || "unknown";
          // Small random delay to simulate real-world variance
          const delay = Math.floor(Math.random() * 50);
          setTimeout(() => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id, timestamp: Date.now() }));
          }, delay);
          return;
        }

        // Route: POST /data — validates and echoes back
        if (path === "/data" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              if (!parsed.name) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "name is required" }));
                return;
              }
              res.writeHead(201, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  id: Date.now(),
                  ...parsed,
                  created: true,
                }),
              );
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
          return;
        }

        // Route: GET /health
        if (path === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }

        res.writeHead(404);
        res.end();
      });

      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseURL = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    }),
);

beforeEach(() => {
  requestLog = [];
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

// ── Integration Tests ────────────────────────────────────────

describe("HttpClient Integration", () => {
  describe("Retry behavior", () => {
    it("should retry on 503 and eventually succeed", async () => {
      const client = new HttpClient({
        baseURL,
        retries: 3,
        retryDelay: 50,
        maxDelay: 200,
      });

      const res = await client.get<{ success: boolean; attempt: number }>(
        "/retry-counter?failCount=2",
      );

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.attempt).toBe(3); // succeeded on 3rd attempt
    }, 10000);

    it("should handle rate limiting (429) with retry", async () => {
      const client = new HttpClient({
        baseURL,
        retries: 2,
        retryDelay: 50,
        maxDelay: 200,
      });

      const res = await client.get<{ success: boolean }>("/rate-limited");

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    }, 10000);

    it("should fail after exhausting retries", async () => {
      const client = new HttpClient({
        baseURL,
        retries: 1,
        retryDelay: 50,
        maxDelay: 200,
      });

      // Server fails 2 times, but we only allow 1 retry (2 total attempts)
      await expect(
        client.get("/retry-counter?failCount=5"),
      ).rejects.toBeInstanceOf(HttpError);
    }, 10000);
  });

  describe("Concurrent requests", () => {
    it("should handle multiple concurrent GET requests", async () => {
      const client = new HttpClient({ baseURL, retries: 0 });

      const requests = Array.from({ length: 10 }, (_, i) =>
        client.get<{ id: string }>(`/concurrent?id=${i}`),
      );

      const results = await Promise.all(requests);

      expect(results).toHaveLength(10);
      results.forEach((res, i) => {
        expect(res.status).toBe(200);
        expect(res.data.id).toBe(String(i));
      });
    });

    it("should handle mixed concurrent requests", async () => {
      const client = new HttpClient({ baseURL, retries: 0 });

      const results = await Promise.allSettled([
        client.get("/health"),
        client.post("/data", { name: "Test" }),
        client.get("/concurrent?id=mixed"),
        client.get("/nonexistent"), // This should fail
      ]);

      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("fulfilled");
      expect(results[2].status).toBe("fulfilled");
      expect(results[3].status).toBe("rejected");
    });
  });

  describe("Request/Response lifecycle", () => {
    it("should complete a full CRUD workflow", async () => {
      const client = new HttpClient({ baseURL, retries: 0 });

      // Create
      const createRes = await client.post<{
        id: number;
        name: string;
        created: boolean;
      }>("/data", { name: "Integration Test" });
      expect(createRes.status).toBe(201);
      expect(createRes.data.name).toBe("Integration Test");
      expect(createRes.data.created).toBe(true);

      // Read
      const healthRes = await client.get<{ status: string }>("/health");
      expect(healthRes.status).toBe(200);
    });

    it("should handle validation errors gracefully", async () => {
      const client = new HttpClient({ baseURL, retries: 0 });

      try {
        await client.post("/data", { email: "missing-name@test.com" });
        fail("Expected HttpError");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).status).toBe(400);
        expect((error as HttpError).responseBody).toContain("name is required");
      }
    });
  });

  describe("Cross-platform compatibility", () => {
    it("should work with different URL formats", async () => {
      const client = new HttpClient({ baseURL, retries: 0 });

      // With leading slash
      const res1 = await client.get("/health");
      expect(res1.status).toBe(200);

      // Without leading slash
      const res2 = await client.get("health");
      expect(res2.status).toBe(200);

      // Absolute URL
      const res3 = await client.get(`${baseURL}/health`);
      expect(res3.status).toBe(200);
    });
  });
});
