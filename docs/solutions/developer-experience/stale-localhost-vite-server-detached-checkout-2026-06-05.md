---
title: Stale localhost Vite server from detached checkout
date: 2026-06-05
category: developer-experience
module: apps/web
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "A local dev server shows UI that does not match origin/main"
  - "A checkout is detached or dirty and may not be the source used by the running Vite process"
  - "Multiple ThinkWork app port conventions make it unclear which app owns localhost:5174"
related_components:
  - tooling
  - documentation
  - testing_framework
tags:
  - local-dev
  - vite
  - worktrees
  - spaces
  - detached-head
  - stale-checkout
---

# Stale localhost Vite server from detached checkout

## Context

On June 5, 2026, `localhost:5174/settings/knowledge-graph` showed the old
Spaces Knowledge Graph infrastructure page: the Cognee deployment/status panel.
That was confusing because `origin/main` already contained the newer Knowledge
Graph Explorer UI.

The root cause was not a stale browser tab, missing deployment, or wrong app.
The process bound to `:5174` was Spaces, but it was serving from an older
detached checkout at `/Users/ericodom/Projects/thinkwork`, not from current
`origin/main`.

The safe fix was to create a clean worktree from `origin/main`, copy
`apps/web/.env` into it, verify the Spaces tests and typecheck, kill the old
listener, and restart Vite from the clean worktree on the requested port.

## Guidance

When a localhost route looks stale, verify the running process and checkout
before assuming the browser, Vite cache, React route, or deployed API is wrong.

Start by checking what owns the port:

```bash
lsof -nP -iTCP:5174 -sTCP:LISTEN
```

Then inspect the process command and working directory:

```bash
ps -p <PID> -o pid,ppid,command
lsof -p <PID> | rg cwd
```

If the listener is serving from an unexpected checkout, do not patch a dirty
main checkout just to verify the fix. Create a clean worktree from `origin/main`:

```bash
git fetch origin

git worktree add \
  /Users/ericodom/Projects/thinkwork/.Codex/worktrees/kg-spaces-data-ui \
  origin/main
```

For Spaces verification, copy the ignored env file before starting the dev
server:

```bash
cp /Users/ericodom/Projects/thinkwork/apps/web/.env \
  /Users/ericodom/Projects/thinkwork/.Codex/worktrees/kg-spaces-data-ui/apps/web/.env
```

Install dependencies from the worktree root:

```bash
cd /Users/ericodom/Projects/thinkwork/.Codex/worktrees/kg-spaces-data-ui
pnpm install
```

Run focused verification before replacing the listener:

```bash
pnpm --filter @thinkwork/web test -- \
  SettingsKnowledgeGraph.test.ts \
  KnowledgeGraphExplorer.test.tsx

pnpm --filter @thinkwork/web typecheck
```

Kill the stale listener only after confirming it is the wrong process:

```bash
kill <OLD_PID>
```

Start Spaces explicitly from the clean worktree, even if `5174` is usually
documented as the admin dev port:

```bash
cd /Users/ericodom/Projects/thinkwork/.Codex/worktrees/kg-spaces-data-ui/apps/web
pnpm dev --host 127.0.0.1 --port 5174
```

In the incident that prompted this doc, the stale listener was node PID `54166`
on `:5174`. The corrected listener was node PID `71225` on
`127.0.0.1:5174`, with cwd under:

```bash
/Users/ericodom/Projects/thinkwork/.Codex/worktrees/kg-spaces-data-ui/apps/web
```

## Why This Matters

A browser screenshot can prove what UI is visible, but it cannot prove which
app, branch, or checkout is serving it. In this case, screenshot-based
diagnosis pointed at the visible symptom: the old Cognee deployment/status
page. The useful evidence came from the listener process, cwd, and served source
modules.

This matters especially in ThinkWork because the main checkout may be detached
and dirty, and multiple sessions may have work in flight. Verification-only
changes should not be patched into a dirty main checkout. A clean worktree gives
a known baseline from `origin/main` and protects unrelated user changes.

It also matters because repo guidance says the admin dev server commonly uses
port `5174`, but ports are not identity. In this incident, the user explicitly
wanted `apps/web` to reuse `5174`. The correct question was not "what
usually runs on this port?" but "what process is actually listening, and from
which cwd?"

## When to Apply

- `localhost:<port>` shows UI that contradicts the current branch or
  `origin/main`.
- A Vite app appears stale after code changes, branch changes, or worktree
  switches.
- The same port is reused across Admin, Spaces, or another app by explicit user
  request.
- The main checkout is detached, dirty, or shared with other sessions.
- API-backed Spaces pages need local verification from a worktree.
- Browser evidence and source evidence disagree.

Do not infer the served checkout from the URL, app title, or screenshot alone.
Verify the listener and cwd.

## Examples

Checking the stale listener:

```bash
lsof -nP -iTCP:5174 -sTCP:LISTEN
ps -p 54166 -o pid,ppid,command
lsof -p 54166 | rg cwd
```

Creating and preparing the clean Spaces worktree:

```bash
git fetch origin

git worktree add \
  /Users/ericodom/Projects/thinkwork/.Codex/worktrees/kg-spaces-data-ui \
  origin/main

cd /Users/ericodom/Projects/thinkwork/.Codex/worktrees/kg-spaces-data-ui

cp /Users/ericodom/Projects/thinkwork/apps/web/.env apps/web/.env
pnpm install
```

Verifying the app before replacing the listener:

```bash
pnpm --filter @thinkwork/web test -- \
  SettingsKnowledgeGraph.test.ts \
  KnowledgeGraphExplorer.test.tsx

pnpm --filter @thinkwork/web typecheck
```

Restarting Spaces on the requested port:

```bash
kill 54166

cd /Users/ericodom/Projects/thinkwork/.Codex/worktrees/kg-spaces-data-ui/apps/web
pnpm dev --host 127.0.0.1 --port 5174
```

Confirming the served UI is the current explorer:

```bash
lsof -nP -iTCP:5174 -sTCP:LISTEN
lsof -p 71225 | rg cwd
curl -s http://127.0.0.1:5174/src/components/settings/SettingsKnowledgeGraph.tsx |
  rg "KnowledgeGraphExplorer|Open thread ingest|Data|Definitions"
```

For this Knowledge Graph incident, another useful source check confirmed the
Explorer module no longer included the removed controls:

```bash
curl -s http://127.0.0.1:5174/src/components/settings/knowledge-graph/KnowledgeGraphExplorer.tsx |
  rg "All types|All grounding|All provenance|Wiki|Brain" || true
```

## Related

- [Cognee Thread Ingest Explorer Validation Pattern](../best-practices/cognee-thread-ingest-explorer-2026-06-04.md) - product-area validation for the same Knowledge Graph Explorer surface.
- [Stale tsbuildinfo in fresh worktree breaks api typecheck via degraded Drizzle inference](../build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md) - adjacent stale-worktree pattern in TypeScript compile caches.
- [Update Cognito callback URLs](../runbooks/update-cognito-callback-urls-2026-05-22.md) - related local port concern when new dev-server ports need OAuth callback allowlisting.
- [apps/web urql document cache doesn't auto-invalidate on live events](../integration-issues/spaces-urql-doc-cache-no-live-invalidation.md) - same app family and stale-looking UI symptom, different root cause.
