---
title: "fix: CLI GraphQL document serialization"
type: fix
status: completed
date: 2026-05-02
---

# fix: CLI GraphQL document serialization

## Overview

Fix CLI GraphQL requests that pass generated `TypedDocumentNode` JSON ASTs into `@urql/core` and can fail at runtime with `Must provide query string`, as seen during the deployed `thinkwork wiki compile` smoke.

## Problem Frame

The CLI codegen preset emits plain JSON GraphQL documents cast as `TypedDocumentNode`. The shared CLI wrappers `gqlQuery` and `gqlMutate` pass those objects directly into `client.query` / `client.mutation`. In the deployed wiki smoke, this produced a server-side request without a usable GraphQL query string. The CLI already owns a shared GraphQL wrapper, so the fix should normalize documents once there rather than patch individual wiki/eval commands.

## Requirements Trace

- R1. `thinkwork wiki compile` sends a real GraphQL query string for generated documents.
- R2. The fix applies to all CLI `gqlQuery` / `gqlMutate` calls, not only wiki commands.
- R3. Existing string/gql documents remain compatible.
- R4. Error unwrapping behavior remains unchanged.
- R5. Tests cover generated AST normalization for both query and mutation paths.

## Scope Boundaries

- Do not regenerate CLI codegen unless implementation proves it is necessary.
- Do not rewrite commands to inline `fetch`.
- Do not change API GraphQL schema or resolver behavior.
- Do not touch unrelated Symphony files in the worktree.

## Context & Research

### Relevant Code and Patterns

- `apps/cli/src/lib/gql-client.ts` owns `getGqlClient`, `gqlQuery`, `gqlMutate`, and error unwrapping.
- `apps/cli/src/commands/wiki/gql.ts` imports generated documents via `graphql(...)`.
- `apps/cli/src/gql/graphql.ts` contains generated JSON AST documents such as `CliCompileWikiNowDocument`.
- `apps/cli/__tests__/gql-client.test.ts` already tests wrapper unwrapping and can be extended to assert document normalization.
- `apps/cli/package.json` includes both `@urql/core` and `graphql`; `@urql/core` exports `stringifyDocument`.

### Institutional Learnings

- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md`: keep service/auth behavior narrow; this fix should stay in client serialization rather than broadening backend request handling.

### External References

- No external research needed. The installed `@urql/core` package exposes `stringifyDocument`, and the repo has a shared CLI wrapper.

## Key Technical Decisions

- **Normalize in `gql-client.ts`:** This makes every generated CLI operation safe and keeps command files unchanged.
- **Use `stringifyDocument`:** Prefer urql's serializer so generated ASTs, `gql` documents, and string documents normalize consistently.
- **Own the CLI HTTP boundary:** Use a tiny CLI transport with the existing `.query(...).toPromise()` / `.mutation(...).toPromise()` surface so every request sends an explicit `{ query, variables }` JSON payload.
- **Keep the public wrapper shape:** Commands still pass typed documents and variables; only the shared transport internals change.

## Open Questions

### Resolved During Planning

- Should the wiki command use raw `fetch` like login does? No. The shared wrapper exists specifically to centralize auth, errors, and request behavior.

### Deferred to Implementation

- Exact helper type signature: choose the smallest TypeScript-compatible helper once the local `@urql/core` exported types are inspected during implementation.

## Implementation Units

- U1. **Normalize CLI GraphQL Documents**

**Goal:** Ensure generated AST documents become query strings before the CLI sends them over HTTP.

**Requirements:** R1, R2, R3.

**Files:**

- Modify: `apps/cli/src/lib/gql-client.ts`
- Test: `apps/cli/__tests__/gql-client.test.ts`

**Approach:**

- Import `stringifyDocument` and `CombinedError` from `@urql/core`.
- Add a small helper that accepts the existing wrapper document input and returns a serialized query string when the input is a document object.
- Use that helper in both `gqlQuery` / `gqlMutate` and in the shared CLI GraphQL transport.
- Preserve variable typing and error unwrapping.

**Patterns to follow:**

- `apps/cli/src/lib/gql-client.ts`
- `apps/cli/__tests__/gql-client.test.ts`

**Test scenarios:**

- Happy path: `gqlQuery` passes a generated AST as a string query to the fake client.
- Happy path: `gqlMutate` passes a generated AST as a string query to the fake client.
- Regression: error unwrapping still concatenates GraphQL errors.
- Regression: no-data defensive error remains unchanged.

**Verification:** CLI unit tests and CLI typecheck pass.
