/**
 * Unit tests for HttpClient.
 *
 * Uses a local HTTP server (no external dependencies) to verify
 * GET/POST/PUT/PATCH/DELETE, headers, query params, error handling,
 * and timeout behavior.
 *
 * These tests run in the "unit" test type for the matrix CI workflow.
 */

import http from "node:http";
import { HttpClient, HttpError } from "../../src";

let server: http.Server;
let baseURL: string;

// ── Test Server Setup ──────────────────────────────────────
beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost`);
        const path = url.pathname;
        let body = "";

        req.on("data", (chunk) => {
          body += chunk;
        });

        req.on("end", () => {
          // Route: GET /health
          if (path === "/health" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", version: "1.0.0" }));
            return;
          }

          // Route: GET /users
          if (path === "/users" && req.method === "GET") {
            const name = url.searchParams.get("name");
            const users = [
              { id: 1, name: "Alice" },
              { id: 2, name: "Bob" },
            ];
            const filtered = name
              ? users.filter((u) => u.name === name)
              : users;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(filtered));
            return;
          }

          // Route: POST /users
          if (path === "/users" && req.method === "POST") {
            const parsed = JSON.parse(body);
            res.writeHead(201, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: 3, ...parsed }));
            return;
          }

          // Route: PUT /users/1
          if (path === "/users/1" && req.method === "PUT") {
            const parsed = JSON.parse(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: 1, ...parsed }));
            return;
          }

          // Route: PATCH /users/1
          if (path === "/users/1" && req.method === "PATCH") {
            const parsed = JSON.parse(body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: 1, name: "Alice", ...parsed }));
            return;
          }

          // Route: DELETE /users/1
          if (path === "/users/1" && req.method === "DELETE") {
            res.writeHead(204);
            res.end();
            return;
          }

          // Route: GET /echo-headers
          if (path === "/echo-headers" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(req.headers));
            return;
          }

          // Route: GET /error/:code
          const errorMatch = path.match(/^\/error\/(\d+)$/);
          if (errorMatch) {
            const code = parseInt(errorMatch[1], 10);
            res.writeHead(code, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Error ${code}` }));
            return;
          }

          // Route: GET /slow (delays response)
          if (path === "/slow" && req.method === "GET") {
            setTimeout(() => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ delayed: true }));
            }, 3000);
            return;
          }

          // Route: GET /text (plain text response)
          if (path === "/text") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Hello, World!");
            return;
          }

          // Default: 404
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not Found" }));
        });
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

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);

// ── Tests ──────────────────────────────────────────────────

describe("HttpClient", () => {
  let client: HttpClient;

  beforeEach(() => {
    client = new HttpClient({
      baseURL,
      timeout: 5000,
      retries: 0, // Disable retries for unit tests
    });
  });

  describe("GET requests", () => {
    it("should fetch data successfully", async () => {
      const res = await client.get<{ status: string }>("/health");
      expect(res.status).toBe(200);
      expect(res.data.status).toBe("ok");
    });

    it("should return typed response data", async () => {
      const res = await client.get<Array<{ id: number; name: string }>>(
        "/users",
      );
      expect(res.status).toBe(200);
      expect(res.data).toHaveLength(2);
      expect(res.data[0].name).toBe("Alice");
    });

    it("should pass query parameters", async () => {
      const res = await client.get<Array<{ id: number; name: string }>>(
        "/users",
        {
          params: { name: "Bob" },
        },
      );
      expect(res.data).toHaveLength(1);
      expect(res.data[0].name).toBe("Bob");
    });

    it("should handle plain text responses", async () => {
      const res = await client.get<string>("/text");
      expect(res.status).toBe(200);
      expect(res.data).toBe("Hello, World!");
    });
  });

  describe("POST requests", () => {
    it("should send JSON body and parse response", async () => {
      const res = await client.post<{ id: number; name: string }>("/users", {
        name: "Charlie",
      });
      expect(res.status).toBe(201);
      expect(res.data.id).toBe(3);
      expect(res.data.name).toBe("Charlie");
    });
  });

  describe("PUT requests", () => {
    it("should update a resource", async () => {
      const res = await client.put<{ id: number; name: string }>("/users/1", {
        name: "Alice Updated",
      });
      expect(res.status).toBe(200);
      expect(res.data.name).toBe("Alice Updated");
    });
  });

  describe("PATCH requests", () => {
    it("should partially update a resource", async () => {
      const res = await client.patch<{ id: number; name: string; age: number }>(
        "/users/1",
        { age: 30 },
      );
      expect(res.status).toBe(200);
      expect(res.data.name).toBe("Alice");
      expect(res.data.age).toBe(30);
    });
  });

  describe("DELETE requests", () => {
    it("should delete a resource", async () => {
      const res = await client.delete("/users/1");
      expect(res.status).toBe(204);
    });
  });

  describe("Headers", () => {
    it("should send default headers", async () => {
      const res = await client.get<Record<string, string>>("/echo-headers");
      expect(res.data["content-type"]).toBe("application/json");
      expect(res.data["accept"]).toBe("application/json");
    });

    it("should merge per-request headers", async () => {
      const res = await client.get<Record<string, string>>("/echo-headers", {
        headers: { "X-Custom": "test-value" },
      });
      expect(res.data["x-custom"]).toBe("test-value");
    });

    it("should support custom default headers", async () => {
      const customClient = new HttpClient({
        baseURL,
        headers: { Authorization: "Bearer token123" },
        retries: 0,
      });
      const res =
        await customClient.get<Record<string, string>>("/echo-headers");
      expect(res.data["authorization"]).toBe("Bearer token123");
    });
  });

  describe("Error handling", () => {
    it("should throw HttpError on 404", async () => {
      try {
        await client.get("/nonexistent");
        fail("Expected HttpError");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.status).toBe(404);
        expect(httpError.isRetryable).toBe(false);
      }
    });

    it("should throw HttpError on 500", async () => {
      try {
        await client.get("/error/500");
        fail("Expected HttpError");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.status).toBe(500);
        // 500 is retryable by default config
        expect(httpError.isRetryable).toBe(true);
      }
    });

    it("should throw HttpError on 400", async () => {
      try {
        await client.get("/error/400");
        fail("Expected HttpError");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).status).toBe(400);
        expect((error as HttpError).isRetryable).toBe(false);
      }
    });

    it("should include response body in error", async () => {
      try {
        await client.get("/error/422");
        fail("Expected HttpError");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).responseBody).toContain("Error 422");
      }
    });
  });

  describe("Timeout", () => {
    it("should timeout on slow requests", async () => {
      const fastClient = new HttpClient({
        baseURL,
        timeout: 500,
        retries: 0,
      });

      try {
        await fastClient.get("/slow");
        fail("Expected timeout error");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).message).toContain("timeout");
      }
    }, 10000);
  });

  describe("Absolute URLs", () => {
    it("should support absolute URLs bypassing baseURL", async () => {
      const res = await client.get<{ status: string }>(`${baseURL}/health`);
      expect(res.status).toBe(200);
      expect(res.data.status).toBe("ok");
    });
  });
});
