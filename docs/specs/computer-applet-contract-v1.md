---
title: Computer applet contract v1
type: spec
status: active
date: 2026-05-09
plan: docs/plans/2026-05-09-001-feat-computer-applets-reframe-plan.md
origin: docs/brainstorms/2026-05-09-computer-applets-reframe-requirements.md
---

# Computer applet contract v1

This document freezes the v1 contract for agent-generated applets in
`apps/computer`. It is the coordination artifact for the applets reframe
and supersedes the origin brainstorm wherever the implementation plan made
an explicit storage or runtime decision.

Future incompatible changes should create a sibling spec such as
`computer-applet-contract-v2.md`; do not silently rewrite this contract once
downstream units depend on it.

## Scope

Applet v1 replaces the CRM-locked dashboard manifest path with TSX source
written by the Computer agent against a constrained import surface. Applets
are private to the caller's tenant, fetched through GraphQL, transformed in
`apps/computer`, and mounted same-origin inside the existing split-view shell.

The origin brainstorm described EFS-backed storage. The implementation plan
resolved the storage substrate to S3 reuse to avoid moving the GraphQL Lambda
into a VPC. This contract follows the plan: applet source and metadata are
stored in the existing private dashboard artifacts bucket under tenant-scoped
keys.

## Strands Tool Surface

The Computer agent receives three tools:

```python
async def save_app(
    name: str,
    files: dict[str, str],
    metadata: dict,
    app_id: str | None = None,
) -> dict: ...

async def load_app(app_id: str) -> dict: ...

async def list_apps() -> dict: ...
```

`save_app` is the only write tool. A null or empty `app_id` creates a new
applet. A provided `app_id` regenerates that stable applet, increments the
metadata version, and overwrites the newest source. There is no separate
`regenerate_app` Strands tool.

Tool responses must preserve these smoke-pin fields:

```json
{
  "ok": true,
  "appId": "uuid",
  "version": 1,
  "validated": true,
  "persisted": true,
  "errors": []
}
```

Validation failures return `ok: false`, `validated: false`, and structured
`errors`. Persistence failures return `ok: false`, `validated: true`,
`persisted: false`, and a reason that the agent can summarize or retry from.

The Python factories snapshot all environment-derived values at construction:
`THINKWORK_API_URL`, `API_AUTH_SECRET`, `TENANT_ID`, `AGENT_ID`, and
`COMPUTER_ID`. Tool bodies must not re-read `os.environ`.

Live HTTP calls use a per-invocation `httpx.AsyncClient`, a 30 second total
timeout, and two retries with exponential backoff. The client is closed before
the tool returns. Tool calls await GraphQL completion; no write is
fire-and-forget.

## GraphQL Surface

The canonical schema surface uses the existing HTTP GraphQL API. AppSync is
not involved for applet v1.

```graphql
enum ArtifactType {
  APPLET
  APPLET_STATE
}

type Applet {
  appId: ID!
  name: String!
  version: Int!
  tenantId: ID!
  threadId: ID
  prompt: String
  agentVersion: String
  modelId: String
  generatedAt: AWSDateTime!
  stdlibVersionAtGeneration: String!
}

type AppletPayload {
  applet: Applet!
  files: AWSJSON!
  source: String!
  metadata: AWSJSON!
}

type AppletConnection {
  nodes: [Applet!]!
  nextCursor: String
}

type AppletState {
  appId: ID!
  instanceId: ID!
  key: String!
  value: AWSJSON
  updatedAt: AWSDateTime!
}

input SaveAppletInput {
  appId: ID
  name: String!
  files: AWSJSON!
  metadata: AWSJSON!
}

type SaveAppletPayload {
  ok: Boolean!
  appId: ID
  version: Int
  validated: Boolean!
  persisted: Boolean!
  errors: [AWSJSON!]!
}
```

Queries:

- `applet(appId: ID!): AppletPayload`
- `applets(cursor: String, limit: Int = 50): AppletConnection!`
- `appletState(appId: ID!, instanceId: ID!, key: String!): AppletState`
- `adminApplet(appId: ID!): AppletPayload`
- `adminApplets(userId: ID, cursor: String, limit: Int = 50): AppletConnection!`

Mutations:

- `saveApplet(input: SaveAppletInput!): SaveAppletPayload!`
- `regenerateApplet(input: SaveAppletInput!): SaveAppletPayload!`
- `saveAppletState(appId: ID!, instanceId: ID!, key: String!, value: AWSJSON!): AppletState!`

`saveApplet` and `regenerateApplet` require service-auth bearer credentials
backed by `API_AUTH_SECRET`. Plain Cognito-authenticated users cannot write
applets in v1. Read queries use normal caller tenant scoping and must resolve
Google-federated callers through `resolveCallerTenantId(ctx)`.

Admin reads are separate resolver paths. `adminApplet` and `adminApplets`
perform an operator-role check before resolving the target user or tenant.
End-user `applet` and `applets` do not accept `userId`.

`applets()` returns metadata previews only, newest first, capped at 50 per
page unless a stricter limit is provided. It does not include source bodies.

## Storage Layout

Applet source and metadata live in the existing private dashboard artifacts
bucket. Keys are tenant-scoped and must be validated before any S3 read or
write:

```text
tenants/{tenantId}/applets/{appId}/source.tsx
tenants/{tenantId}/applets/{appId}/metadata.json
```

The v1 source format accepts one to three TSX files through the tool/API
surface, but the initial storage path persists the canonical entry source at
`source.tsx` plus the original file map in metadata when needed. Historical
versions are not retained by the applet contract. Regeneration overwrites the
current source and metadata in place while incrementing `metadata.version`.

`assertAppletKey` must reject path traversal, missing tenant prefixes,
non-applet roots, and keys that do not end in `source.tsx` or `metadata.json`.

## Metadata Schema

Metadata stored at `metadata.json` must include:

```json
{
  "appId": "uuid",
  "name": "Meeting brief",
  "version": 1,
  "tenantId": "uuid",
  "threadId": "uuid-or-null",
  "prompt": "User prompt that caused generation",
  "agentVersion": "string",
  "modelId": "string",
  "generatedAt": "2026-05-09T00:00:00.000Z",
  "stdlibVersionAtGeneration": "0.1.0"
}
```

Parsers fail closed. A malformed metadata file raises a
`MalformedAppletMetadata` error with field-level detail and never returns a
partial object.

## Import And Runtime Validation

Allowed import specifiers are closed to:

- `@thinkwork/ui`
- `@thinkwork/computer-stdlib`
- `useAppletAPI`
- `react/jsx-runtime`
- `react/jsx-dev-runtime`

Validation runs before source persistence:

1. Parse TSX with sucrase to catch syntax errors.
2. Reject import declarations outside the allowlist.
3. Run a content scan for runtime escape hatches.

Forbidden runtime patterns:

```text
\bfetch\b
\bXMLHttpRequest\b
\bWebSocket\b
\bglobalThis\b
\beval\b
\bFunction\s*\(
\bimport\s*\(
\bReflect\b
```

False positives are acceptable in v1. If an agent writes
`fetchOpportunities`, the save path rejects it and the agent can rename during
retry. This scan is a load-bearing v1 same-origin safety boundary alongside
the import shim and CSP.

## Browser Transform Contract

`apps/computer` transforms applet TSX in a Web Worker using sucrase with:

```ts
{
  transforms: ["typescript", "jsx"],
  production: true,
  jsxRuntime: "automatic"
}
```

The import shim uses an acorn AST pass to rewrite bare imports to the host
registry exposed on `globalThis.__THINKWORK_APPLET_HOST__`. Regex-based import
rewriting is out of contract.

The host registry provides React, React JSX runtimes, `@thinkwork/ui`,
`@thinkwork/computer-stdlib`, and the host-owned `useAppletAPI`
implementation. The only module that writes the registry is
`apps/computer/src/applets/host-registry.ts`, called from `main.tsx` before
the app renders.

Compiled modules are loaded from Blob URLs using dynamic `import()`. Cache
keys include:

```text
hash(source) + stdlibVersion + transformVersion
```

Compiled output remains mounted in memory for the current view. If an agent
regenerates the same `appId` while the user is viewing it, the shell shows a
"newer version available" banner when metadata polling sees a higher version;
it does not hot-swap the running module.

## Host Hook Contract

The stdlib exports the hook signature; the actual implementation is supplied
by the apps/computer host registry.

```ts
type SourceStatus = "success" | "partial" | "failed";

type RefreshResult<T = unknown> = {
  data: T;
  sourceStatuses: Record<string, SourceStatus>;
  errors?: Array<{ message: string; sourceId?: string }>;
};

type AppletAPI = {
  useAppletState<T>(
    key: string,
    initialValue: T,
  ): [T, (nextValue: T) => void, { saving: boolean; error?: Error }];
  useAppletQuery<T>(name: string, variables?: Record<string, unknown>): T;
  useAppletMutation<T>(name: string): (variables: Record<string, unknown>) => Promise<T>;
  refresh<T = unknown>(): Promise<RefreshResult<T>>;
};

declare function useAppletAPI(appId: string, instanceId: string): AppletAPI;
```

State is keyed by `(appId, instanceId, key)`. `instanceId` is derived by the
host route from the mount key so two tabs for the same applet do not collide.
State persists through `appletState` and `saveAppletState`, backed by an
`artifacts` row with `type = 'applet_state'` and metadata containing
`appId`, `instanceId`, and `key`.

Applet queries and mutations are curated by host code. Applet-authored TSX
does not send arbitrary GraphQL selections.

## Refresh Contract

Data-driven applets may export:

```ts
export async function refresh(): Promise<RefreshResult>;
```

The apps/computer Refresh control calls this function directly. Refresh does
not re-prompt the agent and does not call a chat mutation. If an applet does
not export `refresh`, the deterministic Refresh control is hidden.

Failures preserve prior rendered data where possible and surface per-source
status using `success`, `partial`, or `failed`.

## UI And Security Constraints

Applets run same-origin in v1. This is an accepted v1 tradeoff for private,
single-user applets; sandboxed iframe isolation is the documented migration
path if sharing or real-world incidents require a stronger boundary.

`apps/computer` must set CSP so `connect-src` is restricted to the app origin
and configured GraphQL endpoint. `script-src` may allow `self` and `blob:` for
compiled applet chunks, but not inline scripts.

`@thinkwork/computer-stdlib` primitives must not expose
`dangerouslySetInnerHTML` props. Applet empty states belong in stdlib
primitives so generated code does not need bespoke empty-state handling.

## Package Boundaries

Dependency direction is one-way:

```text
apps/computer -> @thinkwork/computer-stdlib -> @thinkwork/ui
```

`@thinkwork/computer-stdlib` must not import from `apps/*`,
`@thinkwork/admin`, or `@thinkwork/computer`. Contract tests in the stdlib
package enforce this.

## Acceptance Pins

- A disallowed npm import is rejected before persistence with a structured
  error naming the module.
- A valid applet can be saved, fetched through `applet(appId)`, transformed in
  the worker, dynamically imported, and mounted in the split-view canvas.
- Runtime mount failures render the recoverable applet error surface while the
  shell and transcript pane remain usable.
- `useAppletState` persists and restores state by `(appId, instanceId, key)`.
- Deterministic Refresh invokes the applet export and never re-prompts the
  Computer agent.
- The CRM pipeline-risk fixture is ultimately rendered through this applet
  path, not the legacy `CrmPipelineRiskApp.tsx` orchestrator.
