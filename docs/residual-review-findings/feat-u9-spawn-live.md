# Residual review findings — `feat/u9-spawn-live`

Source: ce-code-review run `20260425-62c4eea9` (autofix mode).
Plan: `docs/plans/2026-04-25-004-feat-u9-spawn-live-plan.md`.
Reviewers dispatched (11): correctness, testing, maintainability, project-standards, agent-native, learnings-researcher, kieran-python, kieran-typescript, security, adversarial, reliability.
Eight `safe_auto` cleanups applied as `fix(review): apply autofix feedback` before this record was written. Full Python suite: 494/494 pass.

This file is the durable no-PR sink — once the PR opens, copy these items into the PR body under `## Residual Review Findings` and let CI / reviewers pick them up.

## Residual Review Findings

### P1

- **[P1][advisory → human] cascade fan-out under chatty parent** (adversarial, conf 75; security cross-references).
  Composer cache (U3) amortizes only the HTTP layer. Every `delegate_to_workspace` call still spawns a real Bedrock sub-agent. At enterprise scale (4 enterprises × 100+ agents) with one chatty agent calling delegate 5×/turn, that's 500+ Bedrock spawns/min. No per-turn rate-limit. Consider per-tenant or per-agent token-budget at the @tool boundary — separate plan-008 follow-up worth its own design.

- **[P1][advisory → human] recursion path-vs-stack mismatch** (adversarial, conf 50).
  `validate_path` enforces depth ≤ 5 by counting path segments, but each `delegate_to_workspace` call restarts from depth 1. A sub-agent that calls `delegate_to_workspace` itself doesn't add to the depth counter. Worst case: 5 sub-agents each calling delegate 5× = 25 effective invocations. v1 risk acceptable (Bedrock latency naturally bounds depth) but worth documenting in the @tool docstring.

- **[P1][gated_auto → downstream-resolver] no Bedrock spawn timeout** (reliability, conf 75).
  `Agent(model, ...)` invokes Bedrock with no explicit timeout / retry / circuit-breaker. Inherits SDK defaults. AgentCore session timeout ~5min; a hung Bedrock call could block the parent's turn. Pass `botocore.config.Config(read_timeout=120, connect_timeout=10, retries={'max_attempts': 2})` into `BedrockModel`. Behavior change in prod → manual.

- **[P1][manual → downstream-resolver] `delegate_to_workspace` docstring missing "from agent root" rule** (agent-native, conf medium).
  `write_memory`'s docstring carefully states "relative from the agent root — sub-agents must compose `{folder}/memory/{basename}.md`". `delegate_to_workspace`'s docstring says "workspace folder path" but doesn't mirror the framing. Sub-agents at depth-1 might pass `"escalation"` instead of `"support/escalation"`. Add the analogous sentence + a nested example.

- **[P1][manual → downstream-resolver] `delegate_to_workspace` docstring buries `warnings`/`skipped_rows` failure mode** (agent-native, conf medium).
  Failure language is buried in a continuation sentence after `Returns ...`. Reformat to bullet-prominent so the LLM reads + acts on the recovery action ("inspect them; the dropped row's skill is NOT callable; recover by editing AGENTS.md or delegating elsewhere").

### P2

- **[P2][gated_auto → downstream-resolver] `/tmp/skills` filesystem adapter at registration is scaffolding the resolver shouldn't need** (maintainability, conf 75).
  `register_skill_tools` returns `skill_meta` without `skill_md_content`; the manifest adapter at `_register_delegate_to_workspace_tool` reads `/tmp/skills/<slug>/SKILL.md` per slug to synthesize the right shape. Better: extend `skill_metadata` in `skill_runner.py` with `skill_md_content` (parser already has it). Deletes the filesystem read, the OSError fallback, and the cross-module coupling on `/tmp/skills`. Architectural fix.

- **[P2][gated_auto → downstream-resolver] factory kwargs explosion (model_factory, agent_factory, tool_decorator)** (maintainability, conf 70).
  Three kwargs are test-only seams polluting the production signature. Drop them; tests can build a stubbed spawn closure via `_make_live_spawn_fn` and pass through the existing `spawn_fn=` seam. Cleaner contract.

- **[P2][advisory → human] `delegate_to_workspace_tool.py` at ~700 lines is mixing concerns** (maintainability, conf 55).
  Split into `delegate_to_workspace_spawn.py` for `_build_sub_agent_system_prompt` + `_make_skill_tool` + `_build_sub_agent_tools` + `_make_live_spawn_fn` + `_TOKEN_EFFICIENCY_RULES`. Judgment call today; required before U11 adds real skill execution to the spawn body.

- **[P2][gated_auto → downstream-resolver] composer cache lock released across `urlopen` call (thundering-herd latent)** (adversarial + reliability, conf 50-80).
  The lock serializes the dict mutation but not the network call. Concurrent cold-miss on the same key triggers N parallel HTTP round-trips. Single-threaded HTTPServer mitigates today; if the runtime ever moves to a multi-threaded server, this becomes hot. Fix: per-key in-flight Future/Event so concurrent miss-on-same-key dedup to one network call.

- **[P2][manual → downstream-resolver] all-skipped routing rows yield zero-tool sub-agent with skipped slugs still in system prompt** (adversarial, conf 75).
  When parser drops every row, sub-agent gets zero tools but the AGENTS.md table is still verbatim-embedded in its system prompt — the LLM sees a skill name in the table, tries to call it, no tool exists → hallucination loops. Either filter the AGENTS.md table to remove skipped rows before injection, OR add a system-prompt note "the following routing rows were skipped: [...]".

- **[P2][manual → downstream-resolver] composer cache returns list-by-reference** (adversarial, conf 75).
  Any future in-place mutation of an entry corrupts every cached read for 30s. Return `copy.deepcopy(entry)` or freeze with `MappingProxyType`. Defensive.

- **[P2][manual → downstream-resolver] symlink-following `/tmp/skills/<slug>/SKILL.md` reads** (adversarial, conf 50).
  Bare `open()` with no `O_NOFOLLOW` or `os.path.islink` check. `/tmp/skills` is server-controlled today, but symlink check is cheap insurance.

- **[P2][advisory → human] tool-result envelope discloses `parent_tenant_id` + `parent_agent_id` to the LLM** (security, conf 50).
  The `resolved_context` returned to the parent LLM contains these IDs. Information disclosure within a single tenant — low impact but worth removing if the parent doesn't need them.

- **[P2][advisory → human] no per-turn rate-limit on delegation fan-out** (security, conf 50).
  Same concern as adversarial cascade above; security framing.

- **[P2][advisory → human] composer-fetch error format-string risks api_secret leakage on urllib internals change** (security, conf 25).
  Defensive — current urllib internals don't leak the secret in error messages, but a future SDK update could.

- **[P2][gated_auto → downstream-resolver] no retry/backoff/circuit-breaker on Bedrock spawn** (reliability, conf 60).
  Configure botocore retries explicitly OR catch `ThrottlingException` and return `ok=False` with typed reason so parent LLM doesn't retry-storm.

- **[P2][gated_auto → downstream-resolver] no negative-cache on composer failure** (reliability, conf 70).
  Tight retry loop on outage. Short-TTL (~2-5s) negative cache that re-raises stored exception within window.

- **[P2][gated_auto → downstream-resolver] live spawn raises on sub-agent errors instead of returning typed `ok: false`** (reliability, conf 65).
  Loses the structured envelope contract. Catch typed sub-agent errors (guardrail, throttle, model error) and return `{ok: False, reason: "<typed>"}` so parent LLM can branch.

- **[P2][advisory → human] `resolved_context: dict[str, Any]` should be a `TypedDict`** (kieran-python, conf 75).
  Eleven well-known keys deserve a typed contract.

- **[P2][advisory → human] `_register_delegate_to_workspace_tool` `tool_decorator` parameter has no type annotation** (kieran-python, conf 75).
  The U6-extracted helper exists for testability; its signature is its contract.

### P3

- **[P3][advisory → human] `aws_region=''` falls through to env (unintended for explicit empty-string callers)** (correctness, conf 75).
- **[P3][advisory → human] factory has 12 kwargs and ~3 independent snapshot blocks** (kieran-python, conf 50). Group into a `dataclass(frozen=True)`.
- **[P3][advisory → human] `ResolvedSkill` rehydration in spawn body is hand-written field-by-field** (kieran-python, conf 50). Use `ResolvedSkill(**rs_dict)`.
- **[P3][advisory → human] `_build_sub_agent_tools` v1 returns SKILL.md content as string, not executable script** (agent-native). Noted; U11 scope.
- **[P3][advisory → human] `deepcopy` of `platform_catalog_manifest` scales with skill count** (reliability, conf 50). Document or use `copy.copy` (skill_md_content is immutable).
- **[P3][advisory → human] `usage_acc` captured by reference; future module-init move would make it lifetime-cumulative** (adversarial). Noted.
- **[P3][manual → downstream-resolver] empty-but-readable SKILL.md branch in registration helper not directly tested** (testing).
- **[P3][advisory → human] live-SDK contract test for Strands Agent constructor** (learnings-researcher).
  Per `bedrock-agentcore-sdk-version-drift-prefer-raw-boto3-2026-04-24`, add a single test that imports the real `Agent` constructor with U9-expected kwargs and asserts the result exposes `inputTokens`/`outputTokens` keys. Catches drift at build time.

### Pre-existing (out of scope)

- Pre-existing plan-sequence collision on main: `2026-04-25-002` used twice (s3-file-orchestration + u9-delegate-to-workspace). This PR correctly uses `004`; the dup is out of scope.
- Stale narrative pointer at `delegate_to_workspace_tool.py:605` calls itself the "spawn-PR follow-up" — this PR IS that follow-up. Minor reader confusion; not a CLAUDE.md rule violation.
- Server.py has 19 pre-existing ruff import-organization warnings unrelated to this PR's edits.

## Source PR-review run context

- Run artifact: `.context/compound-engineering/ce-code-review/20260425-62c4eea9/`
- Per-reviewer JSON files: `correctness.json`, `testing.json`, `maintainability.json`, `project-standards.json`, `kieran-python.json`, `kieran-typescript.json`, `security.json`, `adversarial.json`, `reliability.json`
- Synthesis summary: `.context/compound-engineering/ce-code-review/20260425-62c4eea9/_summary.md`
- HEAD at review time: `9973689` (autofix commit landed after as `fix(review): apply autofix feedback`).
- Verdict: Ready with fixes
