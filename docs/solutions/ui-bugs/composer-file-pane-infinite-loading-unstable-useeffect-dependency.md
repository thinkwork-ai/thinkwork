---
title: "Composer file pane infinite loading from unstable useEffect object dependency"
date: 2026-08-13
category: ui-bugs
module: apps/web settings workspace composer (ComposerWorkspaceEditor)
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - "Permanent 'Loading…' spinner when opening a source file (e.g. INSTRUCTIONS.md) in Settings -> Agents workspace composer"
  - "800+ POSTs to /api/workspaces/files (all HTTP 200) for a single page load plus one file open"
  - "ComposerEditablePane load useEffect re-fired on every parent re-render, re-entering loading state"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - urql
  - workspace-files-api
tags:
  - react
  - useeffect
  - referential-identity
  - request-storm
  - workspace-composer
  - urql
  - infinite-loading
  - settings-agents
---

# Composer file pane infinite loading from unstable useEffect object dependency

## Problem

In Settings → Agents' workspace composer, opening a source file (e.g. an agent's `INSTRUCTIONS.md`) showed a "Loading…" spinner that never resolved, while the browser silently hammered the workspace-files API. Hit by an operator on the live McPherson stage (THINK-806); fixed in PR #4281.

## Symptoms

- Clicking a source file in the composer tree rendered a permanent "Loading…" spinner — the pane never displayed content.
- The network log showed a request storm: **872 POSTs to `/api/workspaces/files`** observed for a single page load plus one file open.
- Every request returned **HTTP 200** — no errors anywhere. The server was answering correctly each time; the client just kept asking.

That combination — spinner that never settles + a storm of identical, successful requests — is the diagnostic signature of a referential-identity effect loop, not a backend fault.

## What Didn't Work

1. **Stale ETag/fingerprint from an out-of-band S3 edit.** The same file had been edited directly in S3 earlier that day, so a stale-fingerprint mismatch was a plausible first suspect. Wrong: every response was a 200 with correct content — the server never rejected anything. Reasonable because the timing lined up; wrong because a fingerprint conflict would surface as errors or conditional-request misses, not clean 200s.
2. **The host page's sync-pending poll loop** in `SettingsCapabilities.tsx`. A polling loop is the obvious owner of repeated requests. Wrong: that loop is bounded by `SYNC_POLL_ATTEMPTS` and only runs while a sync is pending — it cannot produce an unbounded storm. Reasonable because it's the only intentional repeat-requester on the page; wrong because bounded polls can't run away.
3. **A fresh regression.** Git history showed `ComposerWorkspaceEditor.tsx` unchanged since PR #3879 — this was not new code. It was a long-standing latent defect that only surfaced when the settings page got busy enough (more re-render churn) to keep the loop fed. Reasonable because "it just started happening" usually means "something just changed"; wrong because the trigger was environmental (page render frequency), not a code change.

## Solution

**Root cause:** `ComposerEditablePane`'s load `useEffect` depended on `source.target` — an object literal rebuilt by `resolveSource()` on **every parent render**. `resolveSource` (`apps/web/src/components/settings/ComposerWorkspaceEditor.tsx:330`) returns a fresh `SourcePaneResolution` each call, with `target` constructed inline (`{ spaceId }` / `{ userId }` / `{ agentId }` at lines 369, 383, 394), and the parent calls it directly in render (line 1734). The settings page re-renders continuously (urql query result identity churn, footer recompute), so each render produced a new `target` object → the effect deps changed referentially → `setLoading(true)` + another POST → the pane never settled while the page kept rendering.

Before (pre-#4281):

```tsx
  useEffect(() => {
    const reqId = ++loadReq.current;
    setLoading(true);
    setError(null);
    spacesWorkspaceFilesClient
      .getFile(source.target, source.sourceFile)
      ...
  }, [source.target, source.sourceFile]);   // ← source.target is a fresh object every render
```

After (PR #4281, merged; `ComposerWorkspaceEditor.tsx:2051-2072` on main):

```tsx
  // Keep the latest resolution in a ref and key the load on the STABLE string
  // identity: `source` is rebuilt by resolveSource() on every parent render,
  // so depending on `source.target` (a fresh object each time) re-fired this
  // effect — and re-entered loading — on every parent render, hammering
  // /api/workspaces/files for as long as the page kept rendering (THINK-806).
  const sourceRef = useRef(source);
  sourceRef.current = source;
  useEffect(() => {
    const reqId = ++loadReq.current;
    setLoading(true);
    setError(null);
    spacesWorkspaceFilesClient
      .getFile(sourceRef.current.target, sourceRef.current.sourceFile)
      ...
  }, [source.targetKey, source.sourceFile]);   // ← stable strings
```

`targetKey` is a stable string built alongside `target` in `resolveSource` — `"composer-space:${spaceId}"` / `"composer-user:${userId}"` / `"composer-agent:${agentId}"` (lines 370, 384, 395) — so it only changes when the identity actually changes. The `sourceRef` is updated on every render, so when the effect *does* fire it always reads the latest `target`/`sourceFile` without them being deps.

Deployed as canary.458 and verified live: the same file now loads in ~3 seconds with a single request.

## Why This Works

- **Effect deps compare by `Object.is`.** Two structurally identical `{ agentId }` literals from consecutive renders are never equal, so an object built in render is a dependency that changes every render. A string like `composer-agent:<id>` is compared by value and is stable across renders. Keying the effect on `targetKey` makes "did the identity change?" mean what it says.
- **Why the child alone couldn't loop it, but parent churn could.** The effect's own `setLoading(true)` re-renders the child, but a child re-render does not re-run `resolveSource` — that happens in the *parent's* render (line 1734). So the loop is not self-sustaining; it needs the parent to keep rendering. The busy settings page (urql result identity churn, footer recompute) supplied a steady stream of parent renders, and each one handed the pane a brand-new `source.target`, re-arming the effect. That's why the bug lay dormant since PR #3879 and only bit on a render-heavy page.
- **Why the React `key` didn't save it.** The parent mounts the pane with `key={`${source.targetKey}:${source.sourceFile}`}` (line 1743), which correctly remounts the component when the user opens a *different* file. But `key` only controls component identity (mount/unmount) — it does nothing about *prop* identity on re-renders of the same instance. The same mounted pane kept receiving fresh `source` objects, and the effect deps, not the key, decided whether to reload.
- **Why the ref is safe.** `sourceRef.current = source` runs every render, so by the time the deps say "identity changed" and the effect fires, the ref already holds the resolution for that identity. The existing `loadReq` counter still discards responses from superseded loads.

## Prevention

- **Never put render-rebuilt object literals in `useEffect` deps.** If a value comes out of a plain function called during render (`resolveSource(...)`, an inline `{ ... }`, `.map()` results), its members that are objects are new every render. Depend on stable primitives instead — and if the resolver doesn't expose one, add one (that is exactly what `targetKey` is for).
- **Prefer stable string identities as the dep, latest values via a ref.** The `sourceRef` + string-key pattern in `ComposerEditablePane` (`ComposerWorkspaceEditor.tsx:2051-2072`) is the house shape: deps answer "should this re-run?", the ref answers "with what values?".
- **Learn the diagnostic signature:** a spinner that never settles plus a storm of identical all-200 requests to one endpoint = a referential-dep effect loop on the client. Don't burn time on the backend, caching, or ETags — every 200 says the server is fine.
- **Review heuristic:** in review, flag any `useEffect`/`useMemo`/`useCallback` dep list containing a member access on a render-built object — search `useEffect` blocks whose deps include `.target`, `.config`, `.params`, or any property of a value produced by a function call in the same render body. Ask: "is this dep a primitive, or a fresh object?" A stable React `key` on the component does **not** excuse unstable object deps inside it.

## Related Issues

- [React hooks deps/ref misuse in a urql-backed admin graph view](../logic-errors/admin-graph-dims-measure-ref-2026-04-20.md) — the inverse failure mode (empty deps + conditional ref caused a blank render instead of a runaway loop); same hooks-deps-hygiene lesson.
- [Managed folder removal must sever the record first](../ui-bugs/managed-folder-removal-must-sever-record-first-2026-07-06.md) — different bug class in the same ComposerWorkspaceEditor surface.
- [urql doc cache never refetches without an explicit trigger](../integration-issues/spaces-urql-doc-cache-no-live-invalidation.md) — the opposite refetch symptom in the same data layer.
- [Referential identity handling for urql-fed d3-force views](../best-practices/react-native-force-sim-camera-persistence-2026-04-20.md) — same referential-identity theme in the mobile app.
- Linear: THINK-806 (closed). Fix: PR #4281, shipped in `v0.1.0-canary.458`.
