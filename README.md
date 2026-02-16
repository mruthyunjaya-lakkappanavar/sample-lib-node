# @httpkit/client

A typed HTTP client library for Node.js with built-in retry logic, timeout handling, and cross-platform support.

**Zero external dependencies** — uses only Node.js built-in `http`/`https` modules.

## Features

- **Typed responses** — Generic type parameters for request/response data
- **Retry with exponential backoff** — Configurable retry count, delay, and retryable status codes
- **Timeout handling** — Per-request and global timeouts
- **Cross-platform** — Works on Linux, macOS, and Windows (Node.js 18+)
- **Zero dependencies** — No external runtime dependencies

## Installation

```bash
npm install @httpkit/client
```

## Usage

```typescript
import { HttpClient } from '@httpkit/client';

const client = new HttpClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  retries: 3,
  retryDelay: 1000,
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
  },
});

// GET request with typed response
interface User {
  id: number;
  name: string;
  email: string;
}

const response = await client.get<User[]>('/users');
console.log(response.data); // User[]
console.log(response.status); // 200

// POST request
const newUser = await client.post<User>('/users', {
  name: 'Alice',
  email: 'alice@example.com',
});

// With query parameters
const filtered = await client.get<User[]>('/users', {
  params: { role: 'admin', active: true },
});

// Error handling
import { HttpError } from '@httpkit/client';

try {
  await client.get('/protected');
} catch (error) {
  if (error instanceof HttpError) {
    console.log(error.status);        // 401
    console.log(error.isRetryable);   // false
    console.log(error.responseBody);  // raw response
  }
}
```

## CI/CD

This library uses GitHub Actions reusable workflows for CI/CD:

- **Matrix CI** — Tests across Node.js 18/20/22 × Ubuntu/macOS/Windows (9 combinations)
- **Parallel test suites** — Unit tests and integration tests run in parallel
- **Security scanning** — SAST + dependency audit + Trivy
- **Package publishing** — Staging (`@next`) → Production (`@latest`) with approval gates

See [github-shared-workflows](https://github.com/mruthyunjaya-lakkappanavar/github-shared-workflows) for the reusable workflow definitions.

## License

MIT
