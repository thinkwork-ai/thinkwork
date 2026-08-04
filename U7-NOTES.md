# U7 implementation brief (working notes — delete before PR)

Plan: docs/plans/2026-08-03-001-...-plan.md §U7 (lines 253–272) + KTD6 (line 105). THINK-586.

## Discovered structure (packages/agentcore-pi/agent-container/src/server.ts)

- `handleInvocation` flow with phase-log line anchors:
  - runtime.invocation.received ~2814
  - workspace_bootstrap ~2940–2977 (`bootstrapWorkspace` via `deps.bootstrapWorkspaceImpl` ~2746)
  - tool_assembly ~3291–3354 (`buildMcpTools` call ~1951)
  - session_store ~3725+ (`AuroraSessionStore` via `deps.sessionStoreFactory` ~2749–2750; session_resume phase ~1130)
- `makeDeps()` seam in tests/server.test.ts is the stubbing pattern.
- Container-side session verification (my U6 addition) sits in `handleHttpInvocation` — the runtime-only env signal for KTD6 could be... NOTE: KTD6 requires an env var set ONLY on the AgentCore runtime deploy path, absent from Pi Lambda terraform env. The runtime env is mirrored FROM the Lambda env (update-agentcore-runtime-image.sh runtime_env_json), so a naive env var would be mirrored too! Options: (a) have the mirror script INJECT `AGENTCORE_RUNTIME_SESSION_CACHE=1` after mirroring (mirror + overlay), or (b) key off the AgentCore session header presence per-request (but KTD6 wants a deploy-path signal for factory construction). Recommend (a): update-agentcore-runtime-image.sh and runner reconcile_pi_runtime.mjs add the overlay var; document in the module env comment that it must NEVER be added to the Lambda terraform env.

## Cache design (KTD6 verbatim requirements)

- Key: (tenantSlug, agentSlug, userId, threadId, config_fingerprint).
- Factory-constructed (tenant-isolation audit bans module-level bare Maps); construct only when runtime-only env signal present.
- Holds: Pi session, MCP clients + tool definitions (cleanup-queue suppression + transport indirection in mcp-connect.ts), assembled toolset.
- Reuse gates: exact key match AND durable-store freshness probe (cached last-turn marker vs S3 session head; evict on mismatch) AND credential/authorization-version signal (R20). Failed S3 session append on warm turn → evict.
- Per-thread in-process lock around fast-path entry.
- Emit `session_reuse: warm|cold` into usage_json.diagnostics (extend existing contract fields, never parallel ones) + phase log.
- HandleStore + McpToolRegistry stay per-turn.
- S3 durable session store stays correctness source; cache is latency-only.

## Test scenarios: plan §U7 lines 261–271 (10 scenarios incl. tenant-isolation audit extension).

## Verification: dev flag-on thread warm follow-ups show workspace_bootstrap+tool_assembly+session_resume < 200 ms and session_reuse: warm in trace; tenant-isolation suite green.

## State when notes written
- U6 verified live; agent `thinkwork` (c1e4434f) flag ON; U6 thread 8f4cb423-e523-4429-961f-c124948bab85; warm runtime turns 5.9–8.3 s.
- #4180 merged (env-wipe fix). Worktree branched from f40cbbb30 — REBASE onto origin/main before PR.
