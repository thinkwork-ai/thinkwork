---
title: "Computer Artifact Builder CRM recipe autopilot status"
type: status
status: complete
date: 2026-05-09
plan: docs/plans/2026-05-09-007-feat-computer-artifact-builder-crm-recipe-plan.md
---

# Computer Artifact Builder CRM recipe autopilot status

This file records implementation progress, PRs, CI failures, blockers, and
conservative decisions while executing the Artifact Builder CRM dashboard
recipe plan in autopilot mode.

## 2026-05-09

- **Started U1/U2:** Created isolated worktree
  `.Codex/worktrees/artifact-builder-crm-recipe-u1-u2` on branch
  `codex/artifact-builder-crm-recipe-u1-u2` from fresh `origin/main` at
  `947683bf` after PR #1076 merged.
- **Scope decision:** Grouped U1 and U2 in one PR because the plan explicitly
  allows grouping when the diff remains small and the recipe is not useful
  unless it reaches existing Computer backing-agent workspaces.
- **Progress:** Added `references/crm-dashboard.md` under the Artifact Builder
  skill, routed CRM dashboard prompts from `SKILL.md` to that recipe, bumped
  workspace defaults to version 9, and added parity/text-contract tests for
  the canonical CRM dashboard data shape and `save_app`/`refresh()` contract.
- **Progress:** Added an API helper that writes missing Artifact Builder files
  into the backing agent's S3 workspace prefix before Computer thread-turn
  dispatch. It creates absent files, updates only the exact known old platform
  `SKILL.md` by SHA-256, and skips custom `skills/artifact-builder/SKILL.md`
  content so user edits are preserved.
- **Verification note:** Focused workspace-defaults and API helper/routing
  tests passed. Broader `pnpm lint`, `pnpm -r --if-present typecheck`,
  `pnpm -r --if-present test`, touched-file Prettier check, and
  `git diff --check` passed locally before opening the U1/U2 PR.
- **Merged U1/U2:** PR #1077
  (`feat(computer): add Artifact Builder CRM recipe`) was squash-merged to
  `main` at
  `16332758b386db475e544803d39fa58886a5c06d`; CI passed: CLA, lint, test,
  typecheck, verify. The remote branch was deleted by GitHub; the local
  worktree and branch were removed manually because `gh pr merge` could not
  check out local `main` while another worktree owned it.
- **Started U3:** Created isolated worktree
  `.Codex/worktrees/artifact-builder-save-invariant-u3` on branch
  `codex/artifact-builder-save-invariant-u3` from fresh `origin/main` at
  `40d498bc` after PR #1078 merged.
- **Progress:** Implemented the direct `save_app` invariant for Computer
  build-style prompts. The Strands runtime now preserves successful
  `save_app` result fields in tool invocation usage metadata; the API now
  links orphan applet artifacts with returned IDs, records linked artifact
  counts/IDs, and replaces unverified build-success claims with the safe
  Artifact-save-missing response when no direct successful `save_app` evidence
  and no linked applet exist.
- **Verification note:** Focused API runtime tests, API typecheck, and
  Strands streaming tests passed. Broader `pnpm lint`,
  `pnpm -r --if-present typecheck`, and `pnpm -r --if-present test` passed
  locally. Touched-file Prettier check and `git diff --check` passed. A raw
  `uv run ruff check` over the whole Strands `server.py` still reports
  pre-existing import-order/E402/UTC findings, so the U3 Python sanity pass
  used `uv run ruff check --ignore E402,I001,UP017` plus
  `uv run ruff format --check` on the touched Python files.
- **Merged U3:** PR #1079
  (`fix(computer): require saved applet evidence for build turns`) was
  squash-merged to `main` at
  `2bbfe879f48b30b73f611a5ef07b44a2b8b36b4e`; CI passed: CLA, lint, test,
  typecheck, verify. The remote branch was deleted by GitHub; the local
  worktree and branch were removed manually because `gh pr merge` could not
  check out local `main` while another worktree owned it.
- **Started U4:** Created isolated worktree
  `.Codex/worktrees/artifact-builder-crm-smoke-u4` on branch
  `codex/artifact-builder-crm-smoke-u4` from fresh `origin/main` at
  `2bbfe879`.
- **Progress:** Added `scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs`
  for the optional deployed CRM dashboard prompt acceptance path. The script
  dry-runs by default, requires `SMOKE_ENABLE_AGENT_APPLET_PROMPT=1` for live
  AgentCore/model execution, creates a fresh Computer thread in live mode,
  sends the CRM dashboard prompt, waits for the task, asserts a linked applet
  artifact exists, validates applet source shape, opens `/artifacts/{appId}`,
  and prints thread/task/applet diagnostics on failure. Wired it into
  `scripts/smoke-computer.sh` and documented the flag/prompt override in
  `apps/computer/README.md`.
- **Verification note:** `node --check
scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs`,
  `COMPUTER_ENV_FILE=none node
scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs`, `bash -n
scripts/smoke-computer.sh`, touched-file Prettier check, `pnpm lint`,
  `pnpm -r --if-present typecheck`, and `pnpm -r --if-present test` passed
  locally. `git diff --check` passed.
- **Merged U4:** PR #1080
  (`test(computer): add CRM dashboard prompt smoke`) was squash-merged to
  `main` at
  `2e9a463e182eddb21439fafad5deb67ae009d880`; CI passed: CLA, lint,
  test, typecheck, verify. The remote branch was deleted by GitHub; the
  local worktree and branch were removed manually.
- **Started U5/E2E proof:** Created isolated worktree
  `.Codex/worktrees/artifact-builder-crm-e2e-u5` on branch
  `codex/artifact-builder-crm-e2e-u5` from latest `origin/main` at
  `6ca632ef` after PR #1082 merged.
- **Live proof failure:** Ran the deployed live smoke with
  `SMOKE_ENABLE_AGENT_APPLET_PROMPT=1`, prompt
  `Build a CRM pipeline risk dashboard for LastMile opportunities, including
  stale activity, stage exposure, and the top risks to review.`, and thread
  `eead7438-6945-4b16-9d05-207f3da88f4b`. Task
  `134f2d50-34d0-434d-8d4a-92d636078f95` completed without a linked applet.
  Diagnostics showed the model failed to read
  `references/crm-dashboard.md` by relative path, delegated TSX generation,
  and attempted delegated saving through `delegate_to_workspace(path=".")`.
  The Artifact-save-missing guard correctly replaced the response with the
  honest no-artifact message.
- **Progress:** Tightened the Artifact Builder skill to load the CRM recipe by
  full workspace path
  `skills/artifact-builder/references/crm-dashboard.md`, keep applet
  generation/saving in the parent turn, and call `save_app` directly. Added
  the PR #1077 skill SHA to the targeted upgrade set so existing seeded
  Computer workspaces receive the corrected skill while custom skill edits
  remain preserved. Tightened the Strands Computer thread contract to forbid
  `delegate`/`delegate_to_workspace` for applet implementation and saving.
- **Verification note:** Focused workspace-defaults, API, and Strands tests
  passed; `pnpm lint`, `pnpm -r --if-present typecheck`,
  `pnpm -r --if-present test`, `uv run ruff check --ignore
  E402,I001,UP017` on touched Python files, and `git diff --check` passed
  locally. The repo-local Prettier binary was not installed in this worktree,
  so no touched-file Prettier command was available.
- **Merged U5 reliability:** PR #1083
  (`fix(computer): keep artifact builder save in parent turn`) was
  squash-merged to `main` at
  `6b31f0f44e7de4b45dc6c0cbf80686c13cd8b67c`; CI passed: CLA, lint,
  test, typecheck, verify. The deployed `main` pipeline
  `25610876005` passed, including AgentCore runtime update, Computer deploy,
  bootstrap reseed, and Computer thread streaming smoke.
- **Second live proof failure:** Reran the same deployed CRM dashboard smoke
  after PR #1083 deployed. Thread
  `9e7927b6-c9a0-4109-b2e8-3ce4c4626588`, task
  `b01112be-803c-4cc7-a534-da3c3fa5456c` still completed without a linked
  applet. Diagnostics confirmed the upgraded skill and full recipe path were
  loaded, but the model still invoked `delegate_to_workspace` and then
  `delegate` instead of calling the direct `save_app` tool.
- **Progress:** Started branch `codex/artifact-builder-block-delegation-u6`
  from merged `main` to enforce the direct-save contract in runtime. Computer
  applet-build prompts now suppress `delegate` and `delegate_to_workspace`
  from the Strands tool surface so the parent agent must either call
  `save_app` directly or trip the Artifact-save-missing guard honestly.
- **Verification note:** `uv run pytest
  packages/agentcore-strands/agent-container/test_server_chunk_streaming.py`,
  `uv run ruff check packages/agentcore-strands/agent-container/container-sources/server.py
  packages/agentcore-strands/agent-container/test_server_chunk_streaming.py
  --ignore E402,I001,UP017`, and `git diff --check` passed locally.
- **Merged U6 delegate suppression:** PR #1085
  (`fix(computer): suppress delegates for applet builds`) was squash-merged
  to `main` at
  `7cda19f988c4f5d144cbfd693730dd7daf920d1e`; CI passed: CLA, lint,
  test, typecheck, verify. The deployed `main` pipeline
  `25611595263` passed, including AgentCore runtime update and Computer
  deploy.
- **Third live proof failure:** Reran the same deployed CRM dashboard smoke
  after PR #1085 deployed. Thread
  `d01d0c39-4408-46fd-95cc-415563d4ac19`, task
  `ad70dfe3-9a3d-42f6-9382-1f9b51d71421` still completed without a linked
  applet. Diagnostics confirmed `delegate` and `delegate_to_workspace` were
  gone from the tool trace, but the model used `execute_code` as a scratchpad
  and still omitted the direct `save_app` call.
- **Progress:** Started a follow-up runtime enforcement change to suppress
  `execute_code` together with delegation tools for Computer applet-build
  prompts. The parent agent should now have to call the persistent `save_app`
  tool directly with generated TSX.
- **Merged U7 execute-code suppression:** PR #1087
  (`fix(computer): suppress code scratchpad for applet builds`) was
  squash-merged to `main` at
  `38287dd4344fa8acf24ac76c8468d4a4bc93d625`; CI passed: CLA, lint,
  test, typecheck, verify. The deployed `main` pipeline
  `25612160280` passed, including AgentCore runtime update and Computer
  deploy.
- **Fourth live proof failure:** Reran the same deployed CRM dashboard smoke
  after PR #1087 deployed. Thread
  `8e875b4b-7f8b-454b-aa3a-ae5bed356e44`, task
  `1740b072-fa46-46eb-b56e-a8282ffa3969` still completed without a linked
  applet. Diagnostics confirmed `delegate`, `delegate_to_workspace`, and
  `execute_code` were gone from the tool trace. The agent loaded the Artifact
  Builder skill and CRM recipe but attempted `wake_workspace(target:
  "save_app")`, then hit the Artifact-save-missing guard. Root cause:
  `_execute_agent_turn` read `computer_id` from the AgentCore payload but did
  not expose it as `COMPUTER_ID` before `make_save_app_from_env()` ran, so
  applet tool registration failed with missing Computer runtime config and
  `save_app` never appeared in the agent's callable tool surface.
- **Progress:** Started branch `codex/artifact-builder-save-app-env` from
  latest `origin/main` to expose `COMPUTER_ID` and `COMPUTER_TASK_ID` during
  Computer turns and restore them afterward. Focused regression coverage now
  asserts the IDs are present while the Strands agent is constructed and
  removed after the invocation.
- **Merged U8 save-app env fix:** PR #1088
  (`fix(computer): expose applet save env during turns`) was squash-merged
  to `main` at
  `e531ae87295eba626ea58a0ff7e1ca7cef1813c5`; CI passed: CLA, lint,
  test, typecheck, verify. The deployed `main` pipeline
  `25612668174` passed, including AgentCore runtime update and Computer
  deploy.
- **Live save proof succeeded, render proof failed:** Reran the deployed CRM
  dashboard smoke after PR #1088 deployed. Thread
  `3d7837a1-6393-40db-86e3-f1fb6df2c113`, task
  `493c1ab9-c4fe-4b59-8c89-51d77b688f72`, applet
  `ac71f0e9-13fd-48af-87d8-763878950b95` were created successfully. The
  applet route returned HTTP 200 at
  `https://computer.thinkwork.ai/artifacts/ac71f0e9-13fd-48af-87d8-763878950b95`.
  Manual browser verification on `localhost:5174` then found the host import
  rewriter rejected the generated source because it imports `react`, even
  though backend validation allows `react` and the host registry already
  exposes it.
- **Progress:** Started branch `codex/artifact-builder-react-import` from
  latest `origin/main` to align the applet host import rewriter with backend
  validation by allowing and rewriting `react` imports. Focused import-shim
  coverage now includes `import React, { useMemo } from "react"`.
- **Merged render import fix:** PR #1089
  (`fix(computer): render applets that import react`) was squash-merged to
  `main` at `17d64da209800c6a67e4ab248818e40ae5aab69b`; CI passed: CLA,
  lint, test, typecheck, verify. The deployed `main` pipeline
  `25613190201` passed. Local browser verification on `localhost:5174` then
  confirmed the import error was gone for applet
  `ac71f0e9-13fd-48af-87d8-763878950b95`, but rendering failed next with
  `Cannot read properties of undefined (reading 'length')`.
- **Merged viewer chrome cleanup:** PR #1090
  (`fix(computer): remove artifact viewer subheader`) was squash-merged to
  `main` at `ecc1399eeeffe2b733a2f088c23c5129bbc56dc5`; CI passed: CLA,
  lint, test, typecheck, verify. The follow-up deploy pipeline
  `25613583394` is being watched.
- **Progress:** Started branch `codex/artifact-builder-stdlib-aliases` from
  latest `origin/main` to make Computer stdlib primitives tolerate the prop
  names generated by the live CRM dashboard applet while also updating the
  Artifact Builder CRM recipe back to canonical stdlib prop names. `KpiStrip`
  now accepts `cards` and the generated `kpis` alias; `EvidenceList` now
  accepts `items` and the generated `evidence` alias plus `observedAt` as a
  fetched-time alias.
- **Verification note:** `pnpm --filter @thinkwork/computer-stdlib test`,
  `pnpm --filter @thinkwork/computer-stdlib typecheck`,
  `pnpm --filter @thinkwork/workspace-defaults test`,
  `pnpm --filter @thinkwork/workspace-defaults typecheck`, and
  `git diff --check` passed locally. PR #1092 checks passed: CLA, lint, test,
  typecheck, verify.
- **Merged stdlib alias/render-crash fix:** PR #1092
  (`fix(computer): tolerate generated applet prop aliases`) was
  squash-merged to `main` at
  `16c6afc88b6b56912e942edc407e698e9c94bcda`; CI passed: CLA, lint, test,
  typecheck, verify. The deployed `main` pipeline `25613821320` passed,
  including Terraform Apply, Computer deploy, Bootstrap workspace-defaults
  reseed, and Deploy Summary.
- **End-to-end proof succeeded:** The live smoke prompt
  `Build a CRM pipeline risk dashboard for LastMile opportunities, including
  stale activity, stage exposure, and the top risks to review.` created
  thread `3d7837a1-6393-40db-86e3-f1fb6df2c113`, task
  `493c1ab9-c4fe-4b59-8c89-51d77b688f72`, and applet
  `ac71f0e9-13fd-48af-87d8-763878950b95`. Local browser verification on
  `http://localhost:5174/artifacts/ac71f0e9-13fd-48af-87d8-763878950b95`
  loaded the generated LastMile Pipeline Risk Dashboard artifact without the
  old subheader, import error, or `undefined.length` crash. The rendered
  artifact showed refresh controls, source coverage, KPI cards, stage exposure,
  stale activity buckets, top risks, the opportunities table, and supporting
  evidence.
- **Plan status:** Complete. The remaining recommended work is a new artifact
  rendering plan that adopts Vercel AI Elements as the default UI foundation
  for thread artifacts, full artifact views, web previews, sandboxed code
  previews, JSX previews, thinking/tool traces, and generated-artifact error
  states unless a concrete security/runtime blocker is found.
