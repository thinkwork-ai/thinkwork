# Residual review findings — `feat/u9-delegate-to-workspace`

Source: ce-code-review run `20260425-bf226b2b` (autofix mode).
Plan: `docs/plans/2026-04-25-002-feat-u9-delegate-to-workspace-tool-plan.md`.
Reviewers dispatched (10): correctness, testing, maintainability, project-standards, agent-native, learnings-researcher, kieran-python, security, adversarial, reliability.
Three safe_auto cleanups applied as `aee0531 fix(review): apply autofix feedback` before this record was written.

This file is the durable no-PR sink — once the PR opens, copy these items into the PR body under `## Residual Review Findings` and let CI / reviewers pick them up.

## Residual Review Findings

### P0 — gated by inert spawn; must address before spawn-PR ships

- **[P0][advisory → human] `packages/agentcore-strands/agent-container/container-sources/server.py:1433` — `platform_catalog_manifest=None` at registration; every platform-skill row will abort once spawn becomes live** (adversarial, conf 75).
  Production registration hard-codes `platform_catalog_manifest=None`. The resolver's platform-fallback branch (`skill_resolver.py:313`) is gated `if manifest is not None`, so the very first `AGENTS.md` row that references a platform skill will abort with `SkillNotResolvable`. The plan said the manifest threads through existing registration plumbing — this is not honored. Fix in the spawn-PR (or before) by wiring the manifest from the same source `AgentSkills` plugin reads at `server.py:1409-1426`, OR fail loud at registration when the workspace declares a platform-skill row but the manifest is unavailable.

### P1

- **[P1][advisory → human] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:251` + `workspace_composer_client.py:23` — Cascade: composer fetches the FULL composed tree on every call (no `sub_path`)** (adversarial, conf 75).
  `fetch_composed_workspace` does not accept a `sub_path` parameter; the tool fetches the full overlay tree per call. At enterprise scale (memory anchor: 4 enterprises × 100+ agents × ~5 templates) an agent loop calling `delegate_to_workspace` per turn fan-outs to dozens of files per call → self-DDoS of `/api/workspaces/files`. Fix in the spawn-PR by either extending the composer client with a `sub_path` filter or adding a short-TTL in-process cache keyed on `(tenant_id, agent_id)`.

- **[P1][advisory → human] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:266` + `packages/agentcore/agent-container/agents_md_parser.py:217` — Routing-row reserved-name skip silently drops the row's skills** (adversarial, conf 75).
  When parser encounters `goTo="memory/"` (or other reserved name) it warns + skips the whole row. The tool's resolver loop only iterates `ctx.routing`, so the skipped row's skills disappear entirely. Operator typo (`memory/` instead of `memory-team/`) yields a sub-agent booting without expected skills, with the only signal being a parser warning buried in container logs. Fix: bubble parser warnings into `resolved_context["warnings"]`, OR fail-fast on any parser-skipped row.

- **[P1][advisory → human] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:215` + `server.py:1428` — Spawn-PR safety hinges on body-swap of `_spawn_sub_agent_inert`** (adversarial, conf 75).
  Production registration uses `spawn_fn=None` → falls back to `_spawn_sub_agent_inert`. Tests pass `spawn_fn` explicitly → exercise a different code path. If the spawn-PR adds a new `_spawn_sub_agent_real()` function instead of editing the inert body, prod silently keeps inert. Mitigation: add an integration test for the zero-arg registration code path that asserts `ok=True` for a happy path, OR add a boot-time assertion that the inert body has been replaced.

- **[P1][gated_auto → downstream-resolver][needs-verification] `packages/agentcore-strands/agent-container/container-sources/server.py:1424-1451` — Conditional registration silently no-ops on env drift / boot-race** (reliability, conf 60).
  Missing `THINKWORK_API_URL`/`API_AUTH_SECRET`/`TENANT_ID`/`AGENT_ID` logs only `logger.info` and skips registration. Per memory `project_agentcore_deploy_race_env`, warm containers can boot pre-env-injection — those will permanently lack `delegate_to_workspace` until the 15-min reconciler. Promote to `logger.warning` and surface a registration metric so partial-fleet drift is detectable.

- **[P1][manual → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/server.py:1402-1450` — All 4 server.py registration branches untested** (testing, conf 80).
  The 50-line registration block adds 4 untested branches (env-var fallback chain, registration gate, `except ImportError`, else-log path); a regression in env-var name (e.g., `THINKWORK_API_URL` → `THINKWORK_API_BASE`) would not be caught.

### P2

- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py:400` — `_boot_assert` smoke is a tautology** (testing, conf 90). Test only asserts the constant references the module name; never runs `ba.check()` so the actual file-presence regression `_boot_assert` exists to catch is not exercised.
- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:138` — `_find_agents_md_content` defensive branches untested** (testing, conf 75). Three branches (non-Mapping entry skip, matched-path-but-non-string-content, missing path key) have no coverage.
- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:266` — Repeated-slug dedup branch untested** (testing, conf 80). `if slug in resolved_skills: continue` is a deliberate behavioral decision with no test; refactor to last-seen-wins would not be caught.
- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:138` — Bytes/non-str AGENTS.md content silently treated as missing** (adversarial, conf 75). Operator sees "no AGENTS.md" when the actual problem is "AGENTS.md content is wrong type" — the exact "Read diagnostic logs literally" anti-pattern. Distinguish absent vs corrupt with a separate `DelegateToWorkspaceError` message including the actual type.
- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:283` — Non-str slug bypasses `DelegateToWorkspaceError` wrapping** (adversarial, conf 50). The wrap catches only `SkillNotResolvable`; `resolve_skill` raises `ValueError` on bad slug. Broaden the except to `(SkillNotResolvable, ValueError)`.
- **[P2][gated_auto → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:233` — `deepcopy(platform_catalog_manifest)` at scale O(catalog × agents)** (adversarial, conf 50). At catalog maturity (500 skills × 5KB SKILL.md × 100 warm containers) burns 250MB+ redundant. Use `MappingProxyType` / frozen view at the publisher; share by reference.
- **[P2][advisory → human] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:196` — `usage_acc: list` is untyped** (kieran-python, conf 75). Type as `list[dict[str, int]]` to match the existing `sub_agent_usage` shape.
- **[P2][advisory → human] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:197` — `composer_fetch: Callable[..., list[dict]]` loses well-known parameter shape** (kieran-python, conf 75). Use a `Protocol` or precise `Callable[[str, str, str, str], list[dict[str, Any]]]`.
- **[P2][gated_auto → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:61-67` — `DelegateToWorkspaceError` flattens transient and permanent failures** (reliability, conf 65). Composer 5xx, `SkillNotResolvable`, missing AGENTS.md all raise the same exception type. A retry harness can't distinguish without introspecting `__cause__`. Split into `TransientDelegateError` / `PermanentDelegateError` under shared base.
- **[P2][gated_auto → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:172-180` — Inert spawn returns `ok:False` rather than raising** (reliability, conf 55). An LLM that doesn't carefully read the result body may treat the inert `resolved_context` as a real delegation outcome. While inert, raise `DelegateToWorkspaceError("spawn not yet wired")` so the LLM sees a tool error, not an ambiguous success.
- **[P2][gated_auto → downstream-resolver] `packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:172` + factory kwarg — Two seams for one spawn transition** (maintainability, conf 60). Pick one: drop `_spawn_sub_agent_inert` and inline an inert default in the factory, OR drop the `spawn_fn` kwarg and have tests monkeypatch the module-level seam.
- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py:325-339` — Composer-raise test doesn't assert resolver-not-called nor composer args** (testing, conf 70). Plan explicitly says "resolver is NOT called" on composer raise; test only checks spawn isn't called. Composer-call args (snapshotted tenant/agent/api_url/api_secret) are never asserted anywhere.
- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py:316-321` — Reserved-suffix `TestDelegatePathRejection` parametrize covers only 3 of 5 forms** (testing, conf 70). Integration-level "composer not called" assertion is missing the trailing-skills and mid-segment cases.
- **[P2][manual → downstream-resolver] `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py:286-292` — Trailing-slash test only checks `normalized_path`, not full-context identity** (testing, conf 65).

### P3 (advisory)

- **[P3][advisory → human] `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py` — Per-test method imports of `delegate_to_workspace_tool` symbols** (kieran-python + maintainability, conf 50). Hoist `from delegate_to_workspace_tool import (...)` to the top of the test module; conftest already inserts the sys.path entries.
- **[P3][advisory → human] `packages/agentcore-strands/agent-container/container-sources/server.py:1413,1447-1452` — Registration `try/except ImportError` contradicts `_boot_assert`** (kieran-python + maintainability, conf 55). Drop the try/except — `_boot_assert.EXPECTED_CONTAINER_SOURCES` already guarantees module presence at boot.

## Source PR-review run context

- Run artifact: `.context/compound-engineering/ce-code-review/20260425-bf226b2b/`
- Per-reviewer JSON files: `correctness.json`, `testing.json`, `maintainability.json`, `project-standards.json`, `kieran-python.json`, `security.json`, `adversarial.json`, `reliability.json`
- Synthesis summary: `.context/compound-engineering/ce-code-review/20260425-bf226b2b/_summary.md`
- HEAD at review time: `75e0f41` (autofix commit `aee0531` came after)
- Verdict: Ready with fixes
