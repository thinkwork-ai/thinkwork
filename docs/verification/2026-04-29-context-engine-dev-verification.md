# Context Engine Dev Verification - 2026-04-29

## Summary

Dev deploy `25102249020` completed successfully for commit `6a56fb69bbc319c8e805e595f8007a136d4a75bf`. The deployed Context Engine is configured for Hindsight `reflect` mode and the wiki path is separate and fast.

Verification found one correctness issue in the memory provider response shape: deployed `query_memory_context` returned a valid Hindsight reflection hit, but the Context Engine snippet was the generic title `Hindsight reflection` instead of the actual reflection text. This report accompanies the fix in `packages/api/src/lib/context-engine/providers/memory.ts`.

## Deployment Checks

- GitHub Actions deploy: success
- Run URL: `https://github.com/thinkwork-ai/thinkwork/actions/runs/25102249020`
- Deployed commit: `6a56fb69bbc319c8e805e595f8007a136d4a75bf`
- Admin dev server: running on `127.0.0.1:5174`, PID `22594`

## Deployed Configuration

Context Engine Lambda non-secret environment:

```json
{
  "mode": "reflect",
  "timeout": "20000"
}
```

Hindsight ECS task definition: `thinkwork-dev-hindsight:7`

```text
HINDSIGHT_API_RERANKER_PROVIDER=local
HINDSIGHT_API_RERANKER_MAX_CANDIDATES=20
HINDSIGHT_API_RERANKER_LOCAL_BUCKET_BATCHING=true
HINDSIGHT_API_RERANKER_LOCAL_MAX_CONCURRENT=1
HINDSIGHT_API_RECALL_BUDGET_FUNCTION=adaptive
HINDSIGHT_API_RECALL_BUDGET_MIN=5
HINDSIGHT_API_RECALL_BUDGET_MAX=300
```

## Deployed MCP Smoke

Endpoint: `/mcp/context-engine`

Query: `Smoke Tests 27 April 2026`

### `query_memory_context`

- HTTP status: `200`
- Wall time: `8559ms`
- Provider: `memory`
- Provider state: `ok`
- Provider duration: `6701ms`
- Hit count: `1`
- Mode metadata: `reflect`
- Finding: the deployed hit title was `Hindsight reflection`, and the snippet was also `Hindsight reflection`. This proves the call reached reflect mode, but the returned Context Engine hit did not expose the synthesized reflection text to the caller.

### `query_wiki_context`

- HTTP status: `200`
- Wall time: `254ms`
- Provider: `wiki`
- Provider state: `ok`
- Provider duration: `79ms`
- Hit count: `4`
- Top result: `Smoke Tests 27 April 2026`
- Top snippet: `Series of smoke-test interactions on 27 April 2026 involving Pi runtime, web_search, execute_code, Hindsight, and MCP tools.`

The wiki path is separate from Hindsight and remains fast.

## Source Path Checks

- Mobile wiki search still uses GraphQL `mobileWikiSearch`.
- React Native SDK still exposes an explicit Context Engine client/hook for callers that opt into `/mcp/context-engine`.
- Admin Template built-in tools includes Context Engine opt-in controls.
- Admin Capabilities built-in tools includes Context Engine status text.

## Fix Applied

The memory Context Engine provider now uses `hit.record.content.text` as the snippet before falling back to summary. This preserves the stable title `Hindsight reflection` while exposing the actual synthesized reflection text to agents and MCP clients.

Regression coverage added:

- `packages/api/src/lib/context-engine/providers/memory.test.ts`

Focused test command:

```bash
pnpm --filter @thinkwork/api test -- src/lib/context-engine/providers/memory.test.ts src/lib/memory/adapters/hindsight-adapter.test.ts src/lib/context-engine/__tests__/router.test.ts
```

Result: 3 test files passed, 12 tests passed.

## Follow-Ups

- Deploy the snippet fix before treating `query_memory_context` as agent-ready in dev.
- Add an Admin Memory/Knowledge page for Context Engine and Hindsight tuning parameters instead of scattering provider settings across Template toggles.
- Keep mobile wiki search on the dedicated GraphQL path for now; use Context Engine from agent harnesses and explicit SDK callers.
