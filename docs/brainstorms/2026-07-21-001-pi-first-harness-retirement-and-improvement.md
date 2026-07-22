# Pi-First: Managed-Harness Retirement + Pi Improvement Portfolio

**Date:** 2026-07-21 · **Status:** Brainstorm (decision made: NOT proceeding with AWS managed harness)
**Decision basis:** Parity audit (17 gaps, several architecturally unclosable on the harness) + two AWS-side defects proven unfixable caller-side: Kimi toolUseId schema divergence (Converse `[a-zA-Z0-9_.:-]+` vs harness `[a-zA-Z0-9_-]+`) and **no prompt caching** (proven at 100% via live probe 2026-07-21: `additionalParams` splices into the Converse request body — the error listed Converse top-level params — and `HarnessContentBlock` cannot carry cachePoint blocks; ~2.5× cost on tool-heavy work; all 335 dev harness turns ever = 0 cache tokens). Strands (the engine under the harness) already ships `cache_config(strategy="auto")` — AWS support case asks them to expose it, as a revisit trigger.

Three workstreams: **A. Remove** the harness surface safely · **B. Borrow** its governance wins into Pi · **C. Improve** Pi itself.

---

## A. Harness removal (inventory + sequence)

**Master coupling:** nearly the whole harness surface (harness TF module, proof Gateway, proof Identity, turn-assertion KMS/mint, 7 proof/harness Lambdas) hangs off one flag: `enable_agentcore_multiplayer_proof`. The **Twenty CRM OAuth provider lives inside `module agentcore_proof_identity` behind that same flag** and must survive — decoupling it is the hard prerequisite to any flag flip.

### Classification highlights
- **DELETE (harness-only):** `packages/api/src/lib/harness/**` (~20 source files + tests, EXCEPT the two OAuth files below), handlers `harness-runner.ts` + 4 `harness-*-target` handlers (unless repurposed), `turn-assertion-mint.ts` (unless repurposed), proof Lambdas (`agentcore-proof-oauth-provider`, `agentcore-identity-boundary-target`), dispatch branches (chat-agent-invoke `resolveChatInvocationRuntimeType`, `turn-runtime-selection.ts`, sendMessage `requestedRuntime`, wakeup/finalize/stall-monitor agentcore arms, `resolve-runtime-function-name` agentcore branch), GraphQL `agentcoreHarness`/`AGENTCORE` enum/`agentcoreManaged` fields, eval harness turn path, `harness-submit-draft.ts`, web/mobile runtime toggle + AgentConfigSheet runtime picker + eval harness source badge (exact file list pending), terraform `agentcore-harness/**` module + all proof vars/outputs/alarms/SSM profiles + deploy.yml passthrough/guard entries + runner.py payload keys, CLI release harness flags, build-lambdas entries, ~40 dedicated test files. (~102 files mention "harness"; ~35 are false positives — THINK-118 deploy-acceptance "harness", `test/integration/sandbox/_harness/` — untouched.)
- **KEEP-SHARED:** `lib/harness/agentcore-user-oauth.ts` + `agentcore-oauth-callback.ts` (AgentCore Identity 3LO used by live Twenty connector via `handlers/skills.ts` — RELOCATE out of lib/harness first), memory-retain Lambda + memory handlers, `agentcore_memory_id`/`code_interpreter_id`, sandbox interpreters, AgentCore Evaluations surfaces, Twenty pieces of `agentcore-identity/**`.
- **REPURPOSE (decision needed, see B):** `tool-execution-ledger.ts` + redaction + DB table (0264), the 4 Gateway target handlers, `agentcore-gateway/**` TF (Gateway + Cedar + CUSTOM_JWT), turn-assertion mint + KMS + JWKS surface. If B doesn't claim them, they fall to DELETE.
- **DB (deferred drops, after code-removal deploys):** `harness_managed_thread_enrollments`, `harness_participant_sessions`, `harness_participant_session_events` (0261), runtime CHECK narrowing (0257), 0263 column. `runtime_type` columns stay (value narrows to `pi`).
- **Live decommission:** dev harness runtime + endpoints + proof gateway/identity/KMS/SSM; stale `strands`/`flue` dev runtimes (opportunistic sweep); **TEI defaults back to Pi FIRST** (tenant-agent runtime + `runtime_config.defaultThreadRuntime`, drain active `harness_managed_thread_enrollments`); McPherson never had it (verify tfvars at teardown; strip runner.py harness blocks before next customer runner refresh).

### Safe sequence (each step deploys before the next)
1. Flip TEI (and dev default if set) back to Pi; drain harness-pinned threads.
2. **Decouple Twenty identity** onto its own always-on wiring with `moved` blocks (no destroy/recreate); decide Gateway fate (own flag + replacement JWT issuer if turn-assertion KMS dies); update deploy.yml reconcile markers in the same PR.
3. Retire UI (toggle, config sheet, eval badges) + codegen regen in all consumers.
4. Remove dispatch branch + GraphQL schema/resolvers together (drift = cold-start outage).
5. Relocate the two OAuth files, then delete lib/handlers/proof Lambdas/scripts/CLI flags.
6. Terraform destroy: flip `ENABLE_AGENTCORE_MULTIPLAYER_PROOF` GHA var **before** merging (vars snapshot at trigger); use the existing destroy-guard target list; then strip vars/blocks from deploy.yml + runner.py + greenfield in a follow-up.
7. Deferred DB drops via hand-rolled psql + drift gate (destructive AFTER code-removal deploys).

## B. Borrow from the harness into Pi

Premise corrections from the deep dive: **send_email approval and skill-draft review are NOT gaps** — Pi already routes both through the same shared server-side enforcement (email-send policy path returns pending_review+approvalUrl to Pi's extension; Pi drafts land in the same skillDrafts queue via auto-submit). The real borrow list:

1. **Tool-execution ledger** (foundational; unblocks 2-3): paired started/terminal rows with tool_use_id, provider_request_id, policy_decision_id, idempotency_key, per-call cost. Ledger lib + redaction reusable; needs a new `/api/runtime/tool-executions` endpoint (Pi can't write Aurora) + emitter at the mcp tool-wrap seam. Also fixes per-call cost attribution (request-ids are turn-level today).
2. **Signed-turn identity for Pi doors**: mint (KMS) is runtime-agnostic and proven; chat-agent-invoke mints an assertion into the payload; Pi callbacks (activity/finalize/manifest/ledger) present it; API verifies instead of shared-secret + trusted body fields.
3. **Per-call re-authorization + connector-evidence lock** (blocked on 1+2): port the pattern (verify token → re-read canonical turn → per-call isToolAssigned → ledger row; emit_document gated on completed governed-call evidence) into a live `mcp-proxy` execute body. Note: no actual Cedar PDP exists anywhere — "Cedar" was a seam reference only.
4. **Structured withheld-capabilities UI event** (also Pi item C16).
5. **Gateway decision:** keep `agentcore-gateway` + CUSTOM_JWT as Pi's governed tool plane (claims the 4 target handlers + turn-assertion plane) — or drop it and implement 1-3 against direct API endpoints. Recommend: **drop the Gateway**, keep the *patterns*; direct endpoints avoid a second auth plane and the Gateway's raison d'être died with the harness. THINK-315 plan doc stays as blueprint but re-scoped.

## C. Pi improvement portfolio (ranked)

### Tier 1 — quick wins (S, this week)
1. **Stall-monitor root fix**: throttled `last_activity_at` bump in `chat-agent-activity.ts` (~line 265). Kills the false `timed_out` class; unblocks re-enabling the McPherson stall monitor. Precedent: wakeup-processor already bumps.
2. **`PI_CACHE_RETENTION=long` + move `Current date:` out of the cached prefix**: Earendil cache TTL defaults to 5 min (idle threads pay full price) and the date line at position 1 of the system block busts every thread's system cache daily (`system-prompt-compose.ts:325-368`). Est. 20-50% input savings on gappy threads.
3. **Plate overtrigger fix**: `selectRequestedDocumentPlate` bare substring `.includes()` on slugs (min len 3) — "report back when done" hijacks turns into no-tools document mode. Verb-anchored match + stoplist; bias false-negative.
4. **Hoist SDK clients + parallelize pre-loop setup**: ≥5 S3 clients constructed per turn; serial awaits for independent phases (bootstrap/skills/mcp.json/attachments).
5. **Pre-dispatch checkout assertion**: losing concurrent turn currently swallows SessionConflictError but still delivers + finalizes its reply.

### Tier 2 — medium (M, 2-4 weeks)
6. **Parallel tool execution**: one `executionMode:"sequential"` tool serializes the whole batch, and nearly every read-only I/O tool is marked sequential (mcp, web_search/extract, recall, KG). Flip read-only tools parallel; keep execute_code/mutators serial. Biggest per-turn latency win.
7. **Typed Bedrock error classification + throttling backoff**: swallowed ValidationExceptions surface as "successful" empty turns; mis-prefixed model id records $0 success. Capture exception name at SDK boundary; typed runError; exp backoff on retryables; zero-token success terminal.
8. **Proactive session compaction**: SDK compacts only near full window (~180K); trigger via `session_before_compact` hook at 50-60%. Est. 30-60% input savings on long threads; near-term mitigation for session-poisoning growth.
9. **Orphaned-finalize reconciliation**: Event-mode dispatch + dead runtime = turn stuck `running` until stall sweep, completed work discarded. DLQ consumer + `finalizing` marker.
10. **Global MCP tool-result byte cap** (generic MCP results are uncapped into context + session JSONL).
11. **Parallelize + cache MCP connect/listTools** (K serial handshakes per turn today).
12. **Version-guarded finalize** (completes 5; stale-version writeback rejected).
13. **Sandbox session reuse across turns** (fresh StartCodeInterpreterSession per turn; persist sessionId in session blob).
14. **Multi-stage Docker build + warmers** (image ships devDeps + TS + full monorepo source; SnapStart inapplicable to container Lambdas).
15. **Generalize leaked-tool-call rescue** (currently ask_user_question-only; other Kimi leaks pass as prose silently).
16. **Withheld-capabilities structured event** (two drifting prose implementations; user never sees withheld connections).

### Tier 3 — big bets (L)
17. **Tool-execution ledger** (=B1). 18. **Signed-turn identity** (=B2). 19. **Per-call re-auth + evidence lock** (=B3, stacked on 17+18). 20. **Append-only session persistence / bootstrap scaling** — defer full redesign; ship the S canary (session byte-size metric) + manifest-etag short-circuit now.

**Interlock warning:** `empty-response-backstop.ts` imports from the ask-user-question rescue module — silent coupling when touching either.

### Suggested program shape
- **Wave 1 (now):** C1-C5 + removal steps 1-2 (TEI flip + Twenty decouple).
- **Wave 2:** C6-C8 (latency + the two systemic cost levers) + removal steps 3-6.
- **Wave 3:** C17→C18→C19 governance arc + removal step 7 + Gateway decision executed.
- Standing: AWS support case (Kimi id charset + expose Strands cache_config) defines the only revisit trigger for the managed harness.
