---
title: Lambda OPTIONS preflight must bypass auth — browser fetches to API Gateway HTTP API fail otherwise
date: 2026-04-21
category: integration-issues
module: packages/api
problem_type: integration_issue
component: authentication
severity: high
symptoms:
  - "Admin SPA cross-origin fetch blocked with 'Response to preflight request doesn't pass access control check: It does not have HTTP ok status'"
  - "OPTIONS preflight returns 401 with Lambda's {ok:false, error:'Unauthorized'} body"
  - "Direct curl -X POST against the same endpoint returns the expected JSON body"
  - "Unit tests pass — none of them exercise OPTIONS or a cross-origin browser preflight"
  - "Error responses (401/400/500) appear opaque in DevTools — body is hidden when Access-Control-Allow-Origin is missing"
root_cause: missing_workflow_step
resolution_type: code_fix
related_components:
  - tooling
tags:
  - cors
  - preflight
  - lambda
  - api-gateway
  - options
  - authentication
---

# Lambda OPTIONS preflight must bypass auth — browser fetches to API Gateway HTTP API fail otherwise

## Problem

A new REST Lambda handler at `packages/api/workspace-files.ts` (Unit 5 of the workspace overlay plan) routed the browser's CORS preflight `OPTIONS` request through `authenticate()`. Preflights carry no `Authorization` header, so the handler returned 401. Browsers require 2xx on preflight — the admin SPA's subsequent POSTs never fired, and the workspace tab showed "no files" with zero real traffic to the Lambda.

## Symptoms

- Admin workspace tab at `http://localhost:5175` showed empty tree.
- Browser console:

  ```
  Access to fetch at 'https://ho7oyksms0.execute-api.us-east-1.amazonaws.com/api/workspaces/files'
    from origin 'http://localhost:5175' has been blocked by CORS policy:
    Response to preflight request doesn't pass access control check:
    It does not have HTTP ok status.
  ```

- Network tab: `OPTIONS /api/workspaces/files` response status 401, red.
- Direct `curl -X POST …` returned the expected JSON — the Lambda itself was healthy.
- `curl -v -X OPTIONS` with `Origin: http://localhost:5175`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: authorization, content-type` returned `HTTP/2 401` with `{"ok":false,"error":"Unauthorized"}` body. The API Gateway had attached `Access-Control-Allow-*` headers, but the 401 status code alone was enough to fail the browser's preflight check.

## What Didn't Work

- **Tenant-resolution hypothesis.** Suspected `ctx.auth.tenantId` was null for Google-federated users (a real pattern per memory `feedback_oauth_tenant_resolver`). Ruled out by DB inspection. Irrelevant because the request never reached tenant resolution — it died at preflight.
- **"It's a GraphQL issue" (session history).** A reasonable first guess: an earlier workspace-tab outage in the same plan had been GraphQL-related. An explicit `curl -X OPTIONS` reproduction isolated the real failure mode in seconds.

## Solution

`packages/api/workspace-files.ts` — PR #376, merged as `fa843ea3c9ca6432b3d7ed4b2f0f6b1c350ef7c5`.

`APIGatewayProxyEvent` below is a **local shim** declared in `workspace-files.ts`, not `@types/aws-lambda`'s REST-API-v1 type. The canonical helper at `packages/api/src/lib/response.ts` uses `APIGatewayProxyEventV2` from `aws-lambda` — see Prevention §1.

**Before:**

```typescript
interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

export async function handler(event: APIGatewayProxyEvent) {
  const headers = normalizeHeaders(event.headers);
  const auth = await authenticate(headers);  // ← OPTIONS hits this path, no token, 401
  if (!auth) return json(401, { ok: false, error: "Unauthorized" });
  // ...
}
```

**After:**

```typescript
interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  requestContext?: { http?: { method?: string } };  // ← widen shim for preflight check
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-api-key, x-tenant-id, x-principal-id",
  "Access-Control-Max-Age": "3600",
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },  // ← merge into every response
    body: JSON.stringify(body),
  };
}

function corsPreflight(): APIGatewayProxyResult {
  return { statusCode: 204, headers: CORS_HEADERS, body: "" };
}

export async function handler(event: APIGatewayProxyEvent) {
  if (event.requestContext?.http?.method === "OPTIONS") return corsPreflight();  // ← BEFORE auth
  // ...auth + body logic
}
```

Two invariants: (1) `OPTIONS` returns 2xx before any auth check runs; (2) every response — success **and** error — carries `Access-Control-Allow-Origin`, or the browser refuses to expose the body to the page.

`Allow-Origin: "*"` is safe here because auth is bearer-token (Cognito JWT) and `Allow-Credentials` is not set. If this endpoint ever takes cookies, the wildcard must be replaced with an origin allowlist — `"*"` with `Allow-Credentials: true` is a spec violation and a CSRF footgun.

## Why This Works

- **Why curl passed but the browser didn't.** `curl -X POST` is a direct HTTP call; browsers only emit a preflight when the request is cross-origin **and** not "simple." Custom headers like `Authorization` and `Content-Type: application/json` force a preflight. `curl` skips it entirely.
- **Why the preflight failure is unrecoverable at the edge.** Per the Fetch spec (§4.8.7), a successful preflight requires 2xx status **and** response headers covering the requested method/headers. A 401 fails the 2xx requirement outright — the browser never reads the `Allow-*` headers. API Gateway's own CORS config attaches the headers but does **not** rewrite status codes on HTTP API proxy integrations, so a 401-with-CORS-headers is still a 401.
- **Why unit tests passed.** Test events in `workspace-files-handler.test.ts` were all POST-shaped — none carried `requestContext.http.method === "OPTIONS"`. The handler was functionally sound; the failure lived in a code path that never ran.
- **Why error responses also need CORS headers.** On a cross-origin fetch, the browser withholds the response body from the page unless `Access-Control-Allow-Origin` is present. A 401 without it looks opaque in DevTools, hiding the server's real error message.

## Prevention

### 1. Reuse the existing helper for every new REST Lambda

`packages/api/src/lib/response.ts` already encodes the correct pattern — typed against `APIGatewayProxyEventV2` from `aws-lambda` (the HTTP API v2 shape). The bug existed because `workspace-files.ts` is a top-level handler that defined its own minimal shim and didn't import from `response.ts`:

```typescript
// packages/api/src/lib/response.ts — canonical helper
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

export function handleCors(
  event: APIGatewayProxyEventV2,
): APIGatewayProxyStructuredResultV2 | null {
  if (event.requestContext.http.method === "OPTIONS") return cors();
  return null;
}

export function json(body: unknown, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}
```

Idiomatic handler skeleton:

```typescript
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handleCors, json } from "./src/lib/response.js";

export async function handler(event: APIGatewayProxyEventV2) {
  const pre = handleCors(event);
  if (pre) return pre;
  // auth, business logic, return json(...)
}
```

New Lambdas should import from `src/lib/response.ts` rather than rolling their own shim or `json()` helper. The canonical `CORS_HEADERS` in `response.ts` allows a broader method list (`GET, POST, PUT, DELETE, OPTIONS, PATCH`) than the workspace-files literal — prefer the helper.

### 2. Regression-test pattern — mandatory for any new cross-origin Lambda

Two tests, both present in `packages/api/src/__tests__/workspace-files-handler.test.ts` post-fix. The event literal below matches the local shim; if your handler is typed against `APIGatewayProxyEventV2`, cast via `as unknown as Parameters<typeof handler>[0]` rather than filling in all of v2's required fields:

```typescript
it("short-circuits OPTIONS preflight with 204 + CORS headers before auth", async () => {
  authMockImpl.mockResolvedValue(null); // auth deliberately broken
  const res = await handler({
    headers: {},
    requestContext: { http: { method: "OPTIONS" } },
    body: null,
  });
  expect(res.statusCode).toBe(204);
  expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("*");
  expect(res.headers?.["Access-Control-Allow-Methods"]).toMatch(/POST/);
  expect(res.headers?.["Access-Control-Allow-Headers"]).toMatch(/authorization/i);
});

it("emits Access-Control-Allow-Origin on error (401) responses too", async () => {
  authMockImpl.mockResolvedValue(null);
  const res = await handler({ headers: {}, body: null });
  expect(res.statusCode).toBe(401);
  expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("*");
});
```

Both paths need coverage — the first proves OPTIONS is short-circuited, the second proves error responses are still browser-readable.

### 3. Verification blind spot — `curl -X POST` ≠ browser fetch

When smoke-testing a new cross-origin endpoint from the CLI, a POST curl proves the wire format but not the browser-layer behavior. Add one of:

- **Actual browser fetch** from the dev origin. Check the preflight row in DevTools Network tab — status must be 204.
- **Explicit preflight curl** that asserts 2xx:

  ```bash
  curl -sS -o /dev/null -w "%{http_code}\n" -X OPTIONS \
    -H "Origin: http://localhost:5175" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization, content-type" \
    https://.../api/workspaces/files
  # Must print 2xx. 401/403/404 here means broken for browsers.
  ```

This mirrors `feedback_verify_wire_format_empirically` (auto memory [claude]): curl proves wire format but not browser-layer behavior. For CORS, the empirical check must include the preflight explicitly, or add a browser step.

### 4. When diagnosing "tab shows empty," separate the layers

Before Unit 5, the admin workspace tab was hitting `/internal/workspace-files` — a URL **never routed in Terraform**. Calls 404'd, the admin silently showed empty state, and nobody noticed. The CORS failure here is a new failure mode exposed only once Unit 5 wired up a real route. When diagnosing a tab-empty regression after infrastructure work, verify each layer independently: URL routed → preflight 2xx → handler returns content.

## Related Issues

- **PR #373** — `fix(overlay): thread includeContent through /api/workspaces/files list action`. Earlier cross-unit audit finding on the same Lambda; Strands container was getting metadata-only responses because `includeContent` was dropped. Same handler, different bug.
- **PR #375** — `fix(admin): route agent Workspace badge to /workspace (singular)`. The Link-casing fix that preceded the CORS discovery.
- **PR #376** — `fix(overlay): short-circuit OPTIONS preflight + emit CORS headers on every response`. The fix documented here.
- **`packages/api/src/lib/response.ts`** — canonical CORS helper; every REST Lambda should import from here.
- **Auto memory: `feedback_verify_wire_format_empirically`** — the "curl proves wire format, not full behavior" principle. Update its scope hint: for cross-origin endpoints, curl alone is insufficient; add a browser or preflight-curl verification step.
