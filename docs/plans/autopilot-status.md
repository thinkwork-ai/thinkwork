---
title: "Autopilot status ledger"
date: 2026-05-18
status: active
---

# Autopilot Status Ledger

## Current Run: One-Line Enterprise Deploy

Plan: `docs/plans/2026-05-19-002-feat-one-line-enterprise-deploy-plan.md`

Requirements: `docs/brainstorms/2026-05-18-enterprise-customer-deployment-repo-requirements.md`

Target branch: `main`

### Current Unit

- Active unit: U3 One-Shot Bootstrap Orchestrator
- Active branch: `codex/one-line-deploy-u3`
- Active worktree: `.Codex/worktrees/one-line-deploy-u3`
- Started: 2026-05-19
- PR: [#1425](https://github.com/thinkwork-ai/thinkwork/pull/1425)
- CI: pending

### Progress Log

| Date       | Unit | Branch                     | PR                                                           | Status           | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Notes                                                                                                                                                                      |
| ---------- | ---- | -------------------------- | ------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-19 | U1   | `codex/one-line-deploy-u1` | [#1421](https://github.com/thinkwork-ai/thinkwork/pull/1421) | Merged           | `pnpm --filter thinkwork-cli test -- enterprise-preflight.test.ts no-required-options.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter thinkwork-cli build`; `pnpm --filter thinkwork-cli test`; `pnpm -r --if-present lint`; `pnpm -r --if-present typecheck`; `pnpm test`; touched-file Prettier check; `git diff --check`; GitHub checks                                                                                                                | Added GitHub/git readiness preflight after the existing AWS login path. Squash merged as `3511cbcfde8740bc0cbd5a0d6ae2a9703779c29f`.                                       |
| 2026-05-19 | U2   | `codex/one-line-deploy-u2` | [#1423](https://github.com/thinkwork-ai/thinkwork/pull/1423) | Merged           | `pnpm --filter thinkwork-cli test -- enterprise-deploy-routing.test.ts deploy-registration.test.ts no-required-options.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter thinkwork-cli build`; `pnpm --filter thinkwork-cli test`; `pnpm -r --if-present lint`; `pnpm -r --if-present typecheck`; `pnpm test`; touched-file Prettier check; `git diff --check`; GitHub checks                                                                               | Added top-level `thinkwork deploy` enterprise mode routing while preserving the local Terraform default path. Squash merged as `026491a287067797547b19951b7d1b46505d9ba1`. |
| 2026-05-19 | U3   | `codex/one-line-deploy-u3` | [#1425](https://github.com/thinkwork-ai/thinkwork/pull/1425) | Locally verified | `pnpm --filter thinkwork-cli test -- enterprise-deploy-bootstrap.test.ts enterprise-repository.test.ts enterprise-secrets.test.ts enterprise-deploy-routing.test.ts deploy-registration.test.ts no-required-options.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter thinkwork-cli build`; `pnpm --filter thinkwork-cli test`; `pnpm -r --if-present lint`; `pnpm -r --if-present typecheck`; `pnpm test`; touched-file Prettier check; `git diff --check` | Adds one-shot enterprise bootstrap orchestration: repo lifecycle, release checksum, env secrets, commit/push, and workflow dispatch.                                       |

### CI / Merge Log

- 2026-05-19: Started autopilot run. Read `AGENTS.md`, the one-line enterprise deploy plan, the origin enterprise deployment repo requirements, and relevant deployment learnings from `docs/solutions/`.
- 2026-05-19: Created worktree `.Codex/worktrees/one-line-deploy-u1` on branch `codex/one-line-deploy-u1` from `origin/main`.
- 2026-05-19: Started U1 implementation: reusable enterprise preflight helpers plus `thinkwork login` readiness reporting.
- 2026-05-19: U1 local verification passed: focused preflight/no-required-options tests, CLI typecheck, CLI build, full CLI test suite, workspace lint/typecheck, full `pnpm test`, touched-file Prettier check, and `git diff --check`.
- 2026-05-19: Required checks passed for [#1421](https://github.com/thinkwork-ai/thinkwork/pull/1421): `cla`, `verify`, `lint`, `typecheck`, and `test`.
- 2026-05-19: Squash merged [#1421](https://github.com/thinkwork-ai/thinkwork/pull/1421) as `3511cbcfde8740bc0cbd5a0d6ae2a9703779c29f`; deleted the remote/local branch and worktree, then fast-forwarded `main`.
- 2026-05-19: Started U2 in `.Codex/worktrees/one-line-deploy-u2` on branch `codex/one-line-deploy-u2`.
- 2026-05-19: Implemented U2 top-level deploy routing, enterprise deployment repo detection, enterprise component validation, command registration coverage, and metadata registry field extensions.
- 2026-05-19: U2 local verification passed: focused deploy routing/no-required-options tests, CLI typecheck, CLI build, full CLI test suite, workspace lint/typecheck, full `pnpm test`, touched-file Prettier check, and `git diff --check`.
- 2026-05-19: Opened [#1423](https://github.com/thinkwork-ai/thinkwork/pull/1423) for U2; CI pending.
- 2026-05-19: Required checks passed for [#1423](https://github.com/thinkwork-ai/thinkwork/pull/1423), but `main` moved; rebased U2 onto `origin/main`, reran focused routing tests/typecheck, force-pushed, and required checks passed again.
- 2026-05-19: Squash merged [#1423](https://github.com/thinkwork-ai/thinkwork/pull/1423) as `026491a287067797547b19951b7d1b46505d9ba1`; deleted the remote/local branch and worktree, then fast-forwarded `main`.
- 2026-05-19: Started U3 in `.Codex/worktrees/one-line-deploy-u3` on branch `codex/one-line-deploy-u3`.
- 2026-05-19: Implemented U3 one-shot bootstrap orchestration: repo prepare/create/clone, release manifest checksum resolution, non-secret secret summaries with GitHub secret setting, deployment repo commit/push, and workflow dispatch after push.
- 2026-05-19: U3 local verification passed: focused enterprise deploy bootstrap/repository/secrets/routing tests, CLI typecheck/build/full tests, workspace lint/typecheck, full `pnpm test`, touched-file Prettier check, and `git diff --check`.
- 2026-05-19: Opened [#1425](https://github.com/thinkwork-ai/thinkwork/pull/1425) for U3; CI pending.

### Blockers

- None at this time.

---

## Current Run: Ontology-Gated Hindsight Wiki

Plan: `docs/plans/2026-05-19-002-feat-ontology-gated-hindsight-wiki-plan.md`

Target branch: `main`

### Current Unit

- Active unit: U2 — Ontology-Shaped Planner Contract
- Active branch: `codex/ontology-gate-u2`
- Active worktree: `.Codex/worktrees/ontology-gate-u2`
- Started: 2026-05-19
- PR: [#1424](https://github.com/thinkwork-ai/thinkwork/pull/1424)
- CI: pending

### Progress Log

| Date       | Unit | Branch                   | PR                                                           | Status      | Verification                                                                                                                                                                                                                                                                                                                                                              | Notes                                                                                                                                                                                                                                    |
| ---------- | ---- | ------------------------ | ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-19 | U1   | `codex/ontology-gate-u1` | [#1422](https://github.com/thinkwork-ai/thinkwork/pull/1422) | Merged      | `pnpm --filter @thinkwork/api test -- src/lib/ontology/compile-snapshot.test.ts src/lib/ontology/templates.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm dlx prettier@3.5.3 --write ...`; `git diff --check`; GitHub checks                                                                                              | Added the active ontology compile snapshot contract, conservative no-active-version behavior, approved-only sets/maps for entity types/facets/relationships/mappings, relationship endpoint helper, and broader business seed templates. |
| 2026-05-19 | U2   | `codex/ontology-gate-u2` | [#1424](https://github.com/thinkwork-ai/thinkwork/pull/1424) | Implemented | `pnpm --filter @thinkwork/api test -- src/__tests__/wiki-compiler.test.ts src/lib/ontology/compile-snapshot.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm dlx prettier --check packages/api/src/lib/wiki/planner.ts packages/api/src/__tests__/wiki-compiler.test.ts docs/plans/autopilot-status.md`; `git diff --check` | Added ontology snapshot input and ontology-shaped candidate metadata to the Wiki planner contract; kept `compiler.ts` in its existing tab-indented style to avoid whole-file formatter churn.                                            |

### CI / Merge Log

- 2026-05-19: Started autopilot run. Read `AGENTS.md`, the ontology-gated Hindsight Wiki plan, the existing ontology change-set plan, and relevant wiki/ontology repository code.
- 2026-05-19: Created `.Codex/worktrees/ontology-gate-u1` on branch `codex/ontology-gate-u1` from `origin/main`.
- 2026-05-19: U1 local verification passed with focused ontology tests, API typecheck, full API test suite, Prettier write on touched files, and whitespace checks.
- 2026-05-19: Opened [#1422](https://github.com/thinkwork-ai/thinkwork/pull/1422) for U1.
- 2026-05-19: Required checks passed for [#1422](https://github.com/thinkwork-ai/thinkwork/pull/1422). The first merge attempt hit a status-doc conflict after `main` moved; rebased, resolved the status ledger by preserving both active runs, reran focused tests/typecheck/format checks, force-pushed, watched CI pass again, and squash merged as `eecaf4f27c845080179c27461bdf55304a879509`.
- 2026-05-19: Deleted remote/local branch `codex/ontology-gate-u1`, removed `.Codex/worktrees/ontology-gate-u1`, fast-forwarded `main`, and started U2 in `.Codex/worktrees/ontology-gate-u2` on branch `codex/ontology-gate-u2`.
- 2026-05-19: U2 local verification passed with focused planner/compiler tests, API typecheck, full API test suite, targeted Prettier check on formatted touched files, and whitespace checks. `compiler.ts` has pre-existing whole-file Prettier drift, so U2 kept its small compiler changes in the surrounding tab-indented style.
- 2026-05-19: Opened [#1424](https://github.com/thinkwork-ai/thinkwork/pull/1424) for U2.

### Blockers

- None at this time.

---

## Current Run: Requester Memory Processing Stabilization

Plan: `docs/plans/2026-05-18-001-feat-requester-idle-memory-learning-plan.md`

Trigger: live end-to-end failure report for thread `ffca33a9-538a-4e03-b480-ba59ec4a7044`

Target branch: `main`

### Current Unit

- Active unit: stabilize retry/idempotency behavior for requester memory processing
- Active branch: `codex/requester-memory-idempotent-candidates`
- Active worktree: `.Codex/worktrees/requester-memory-idempotent-candidates`
- Started: 2026-05-18 19:15 CDT
- PR: pending
- CI: pending

### Progress Log

| Date       | Unit | Branch                                         | PR                                                           | Status      | Verification                                                                                                                                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ---- | ---------------------------------------------- | ------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-18 | S1   | `codex/requester-memory-stable-journal`        | [#1417](https://github.com/thinkwork-ai/thinkwork/pull/1417) | Deployed    | `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/learner.test.ts`; `pnpm --filter @thinkwork/api typecheck`; CI; deploy run `26067929687`; live rerun of job `01704b7a-c9ff-40cc-83e9-8a333efe9b95` | Removed volatile run ids from working journals and skipped unchanged journal rewrites. Live test normalized `memory/working/2026-05-18.md` once, then immediately reran the same idle job and got `status=no_change`, `changed_files=[]`, one thread heading, no `- Run:` lines, and hash `0b35bd1daa76ae106391850270287da823accaed430c8ed100d4b0f004b9a7dd`. |
| 2026-05-18 | S2   | `codex/requester-memory-idempotent-candidates` | pending                                                      | In progress | `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/learner.test.ts`; `pnpm --filter @thinkwork/api typecheck`; touched-file Prettier check; `git diff --check`                                        | Making staged candidate writes idempotent so weak memory candidates use one stable thread section rather than one append-only run section.                                                                                                                                                                                                                    |

### CI / Merge Log

- 2026-05-18 19:14 CDT: Confirmed PR [#1417](https://github.com/thinkwork-ai/thinkwork/pull/1417) deploy passed and verified the reported thread through the live `job-trigger` Lambda twice.
- 2026-05-18 19:15 CDT: Started S2 in `.Codex/worktrees/requester-memory-idempotent-candidates` on branch `codex/requester-memory-idempotent-candidates`.
- 2026-05-18 19:20 CDT: Implemented stable per-thread candidate sections and skip-on-unchanged candidate writes. Focused requester-memory tests, API typecheck, touched-file Prettier check, and diff whitespace check passed.

### Blockers

- None at this time.

---

## Current Run: Enterprise Customer Deployment Repo

Plan: `docs/plans/2026-05-18-002-feat-enterprise-deployment-repo-plan.md`

Requirements: `docs/brainstorms/2026-05-18-enterprise-customer-deployment-repo-requirements.md`

Target branch: `main`

### Current Unit

- Active unit: Complete - Enterprise Customer Deployment Repo
- Active branch: none
- Active worktree: none
- Started: 2026-05-18 11:37 CDT
- PR: complete
- CI: all required checks passed

### Progress Log

| Date       | Unit | Branch                                  | PR                                                           | Status    | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Notes                                                                                                                                                                                                                                                                                                                            |
| ---------- | ---- | --------------------------------------- | ------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-18 | U1   | `codex/enterprise-release-artifacts-u1` | [#1391](https://github.com/thinkwork-ai/thinkwork/pull/1391) | CI passed | `pnpm test:release`; `bash -n scripts/release/package-static-assets.sh scripts/release/publish-release-assets.sh scripts/build-lambdas.sh`; `pnpm --filter thinkwork-cli build`; `bash scripts/build-lambdas.sh cognito-pre-signup`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm test`; `pnpm dlx prettier@3.5.3 --check ...`; `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/release.yml')"`; `git diff --check`; GitHub checks                                                        | Autopilot started from the approved enterprise deployment repo plan. Created an isolated worktree from `origin/main` for release artifact work.                                                                                                                                                                                  |
| 2026-05-18 | U2   | `codex/enterprise-remote-artifacts-u2`  | [#1393](https://github.com/thinkwork-ai/thinkwork/pull/1393) | CI passed | `pnpm --filter thinkwork-cli test -- terraform-enterprise-artifact-fixture.test.ts no-required-options.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `terraform -chdir=terraform/examples/greenfield init -backend=false`; `terraform -chdir=terraform/examples/greenfield validate`; `terraform fmt -check ...`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm test`; `git diff --check`; GitHub checks                                                                                          | Remote release artifact support merged as `01355dbc6fc3e20cfd6a4289c6f3fc784fecf8dd`.                                                                                                                                                                                                                                            |
| 2026-05-18 | U3   | `codex/enterprise-deploy-template-u3`   | [#1394](https://github.com/thinkwork-ai/thinkwork/pull/1394) | CI passed | `pnpm --filter thinkwork-cli test -- enterprise-template.test.ts no-required-options.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter thinkwork-cli build`; rendered workflow YAML parse; rendered Terraform fmt check; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm test`; `pnpm dlx prettier@3.5.3 --check ...`; `terraform fmt -check ...`; `git diff --check`; GitHub checks                                                                                                     | Built deterministic customer deployment repo template and overlay contract from merged U2. Squash merged as `71fb94f006c3af60fc9858cf48f2424f34d5d4e2`.                                                                                                                                                                          |
| 2026-05-18 | U4   | `codex/enterprise-bootstrap-u4`         | [#1396](https://github.com/thinkwork-ai/thinkwork/pull/1396) | CI passed | `pnpm --filter thinkwork-cli test -- enterprise-bootstrap.test.ts enterprise-registration.test.ts no-required-options.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter thinkwork-cli build`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm test`; `pnpm dlx prettier@3.5.3 --check ...`; `git diff --check`; GitHub checks                                                                                                                                                            | Added the enterprise bootstrap command group, AWS/GitHub adapter seam, deployment metadata registry, OIDC trust policy generation, inline CI deploy policy generation, and dry-run/mutation planning coverage. Squash merged as `67ff4578e0027562c942d77ab7e4c3e0715ba3e8`.                                                      |
| 2026-05-18 | U5   | `codex/enterprise-ci-workflow-u5`       | [#1398](https://github.com/thinkwork-ai/thinkwork/pull/1398) | CI passed | `pnpm --filter thinkwork-cli test -- enterprise-template.test.ts enterprise-workflow-template.test.ts no-required-options.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter thinkwork-cli build`; rendered workflow YAML parse; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm test`; touched-file Prettier check; `git diff --check`; GitHub checks                                                                                                                                    | Expanded the generated deployment workflow for release manifest verification, Lambda/static artifact prep, Terraform apply, customer ECR image copy, AgentCore runtime refresh with endpoint freshness verification, overlay record, smokes, and summary artifacts. Squash merged as `dcf2e21c0b82e9af85b16b53bd17593934bafb68`. |
| 2026-05-18 | U6   | `codex/enterprise-overlay-u6`           | [#1400](https://github.com/thinkwork-ai/thinkwork/pull/1400) | CI passed | `pnpm --filter thinkwork-cli test -- enterprise-overlay.test.ts enterprise-workflow-template.test.ts no-required-options.test.ts`; `pnpm --filter @thinkwork/api test -- customer-overlay-seeds.test.ts eval-seeds.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter thinkwork-cli build`; rendered workflow YAML parse; `pnpm -r --if-present lint`; `pnpm -r --if-present typecheck`; `pnpm test`; touched-file Prettier check; `git diff --check`; GitHub checks | Implemented customer overlay validation, eval pack application, skill/default workspace file application, generated CI overlay invocation, and customer seed source separation. Squash merged as `1d9af8727735e9a4e0201247f6d2826ce1963b18`.                                                                                     |
| 2026-05-18 | U7   | `codex/enterprise-docs-smoke-u7`        | [#1401](https://github.com/thinkwork-ai/thinkwork/pull/1401) | CI passed | `scripts/smoke-enterprise-deployment-template.sh`; `pnpm --filter thinkwork-cli test -- enterprise-doc-links.test.ts enterprise-template.test.ts enterprise-workflow-template.test.ts no-required-options.test.ts`; `pnpm --filter @thinkwork/docs build`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter thinkwork-cli build`; `pnpm -r --if-present lint`; `pnpm -r --if-present typecheck`; `pnpm test`; touched-file Prettier write; `git diff --check`; GitHub checks                                           | Documented the enterprise deployment repo path, generated runbook, overlay contract, and non-mutating template smoke. Squash merged as `4580ddebbabfc5fecbe1fae6af9f76061fdd303e`.                                                                                                                                               |

### CI / Merge Log

- 2026-05-18 11:37 CDT: Started autopilot run. Read `AGENTS.md`, the enterprise deployment repo plan, and prior deployment/release learnings from `docs/solutions/`.
- 2026-05-18 11:37 CDT: First implementation unit selected: U1 Publish Coordinated ThinkWork Release Artifacts.
- 2026-05-18 11:38 CDT: Created worktree `.Codex/worktrees/enterprise-release-artifacts-u1` on branch `codex/enterprise-release-artifacts-u1` from `origin/main`.
- 2026-05-18 11:45 CDT: Implemented release manifest generation, static/release asset helpers, Lambda artifact manifest generation, release workflow deployable artifact publishing, and CLI Terraform bundle cleanup.
- 2026-05-18 11:47 CDT: Local verification passed: release manifest tests, shell syntax checks, CLI build, single Lambda build smoke, workspace typecheck/lint, full `pnpm test`, Prettier check for touched files, release workflow YAML parse, and `git diff --check`.
- 2026-05-18 11:49 CDT: Opened [#1391](https://github.com/thinkwork-ai/thinkwork/pull/1391) for U1.
- 2026-05-18 11:55 CDT: Required GitHub checks for [#1391](https://github.com/thinkwork-ai/thinkwork/pull/1391) passed: `cla`, `verify`, `lint`, `typecheck`, and `test`.
- 2026-05-18 12:03 CDT: Squash merged [#1391](https://github.com/thinkwork-ai/thinkwork/pull/1391) as `7a1d5bf90c36f2c3a7208e2b604099d92e8943d3`; deleted the remote/local branch and worktree, then fast-forwarded `main`.
- 2026-05-18 12:04 CDT: Started U2 in `.Codex/worktrees/enterprise-remote-artifacts-u2` on branch `codex/enterprise-remote-artifacts-u2`.
- 2026-05-18 12:08 CDT: Implemented remote S3 Lambda artifact mode, mutually exclusive local/S3 validation, artifact-required validation for generated enterprise repos, composite/greenfield pass-through variables, and structural CLI tests. Focused tests and Terraform greenfield validation passed.
- 2026-05-18 12:13 CDT: Manual review replaced diagnostic-only Terraform checks with `terraform_data` lifecycle preconditions so invalid Lambda artifact configuration hard-fails planning.
- 2026-05-18 12:16 CDT: Local verification passed for U2: focused CLI artifact fixture test, greenfield Terraform validation, Terraform fmt check, workspace typecheck/lint, full `pnpm test`, and `git diff --check`.
- 2026-05-18 12:18 CDT: Opened [#1393](https://github.com/thinkwork-ai/thinkwork/pull/1393) for U2.
- 2026-05-18 12:23 CDT: Required GitHub checks for [#1393](https://github.com/thinkwork-ai/thinkwork/pull/1393) passed: `cla`, `verify`, `lint`, `typecheck`, and `test`.
- 2026-05-18 12:23 CDT: Squash merged [#1393](https://github.com/thinkwork-ai/thinkwork/pull/1393) as `01355dbc6fc3e20cfd6a4289c6f3fc784fecf8dd`; remote branch was deleted, local branch/worktree removed, and `main` fast-forwarded.
- 2026-05-18 12:24 CDT: Started U3 in `.Codex/worktrees/enterprise-deploy-template-u3` on branch `codex/enterprise-deploy-template-u3`.
- 2026-05-18 12:31 CDT: Implemented the CLI-bundled customer deployment repo template, overlay contract files, deterministic renderer, package bundling for enterprise templates, and template fixture tests.
- 2026-05-18 12:34 CDT: Local verification passed for U3: focused CLI template/no-required-options tests, CLI typecheck/build, rendered workflow YAML parse, rendered Terraform fmt check, workspace typecheck/lint, full `pnpm test`, Prettier check, Terraform template fmt check, and `git diff --check`.
- 2026-05-18 12:36 CDT: Opened [#1394](https://github.com/thinkwork-ai/thinkwork/pull/1394) for U3.
- 2026-05-18 12:38 CDT: Required GitHub checks for [#1394](https://github.com/thinkwork-ai/thinkwork/pull/1394) passed: `cla`, `verify`, `lint`, `typecheck`, and `test`.
- 2026-05-18 12:38 CDT: Squash merged [#1394](https://github.com/thinkwork-ai/thinkwork/pull/1394) as `71fb94f006c3af60fc9858cf48f2424f34d5d4e2`; deleted the remote/local branch and worktree, then fast-forwarded `main`.
- 2026-05-18 12:39 CDT: Started U4 in `.Codex/worktrees/enterprise-bootstrap-u4` on branch `codex/enterprise-bootstrap-u4`.
- 2026-05-18 12:53 CDT: Implemented `thinkwork enterprise bootstrap`, deterministic bootstrap planning, AWS/GitHub mockable adapters, local metadata recording, OIDC trust policy generation, inline deploy policy generation, GitHub Environment/variable setup, secret follow-up reporting, and command registration coverage. Focused CLI tests and CLI typecheck passed.
- 2026-05-18 12:56 CDT: U4 local verification passed: focused enterprise CLI tests, CLI typecheck/build, workspace typecheck/lint, full `pnpm test`, touched-file Prettier check, and `git diff --check`.
- 2026-05-18 12:59 CDT: Opened [#1396](https://github.com/thinkwork-ai/thinkwork/pull/1396) for U4.
- 2026-05-18 13:03 CDT: Required GitHub checks for [#1396](https://github.com/thinkwork-ai/thinkwork/pull/1396) passed, but the branch was behind `main`; rebased onto `origin/main`, reran focused CLI tests and CLI typecheck, and force-pushed.
- 2026-05-18 13:09 CDT: Required GitHub checks passed again for [#1396](https://github.com/thinkwork-ai/thinkwork/pull/1396): `cla`, `verify`, `lint`, `typecheck`, and `test`.
- 2026-05-18 13:09 CDT: Squash merged [#1396](https://github.com/thinkwork-ai/thinkwork/pull/1396) as `67ff4578e0027562c942d77ab7e4c3e0715ba3e8`; remote branch was deleted, local branch/worktree removed, and `main` fast-forwarded.
- 2026-05-18 13:10 CDT: Started U5 in `.Codex/worktrees/enterprise-ci-workflow-u5` on branch `codex/enterprise-ci-workflow-u5`.
- 2026-05-18 13:18 CDT: Implemented the generated CI workflow, release helper scripts, smoke helper, dynamic backend/stage rendering, and workflow contract coverage. Focused template/workflow tests, CLI typecheck/build, rendered workflow YAML parse, and touched-file Prettier check passed.
- 2026-05-18 13:21 CDT: U5 local verification passed: workspace typecheck/lint, full `pnpm test`, and `git diff --check`.
- 2026-05-18 13:27 CDT: Hardened the generated runtime updater to preserve AgentCore role/network/protocol configuration, create the Flue runtime when needed, and wait for the DEFAULT endpoint to serve the copied image. Reran focused workflow tests, CLI typecheck/build, workspace typecheck/lint, full `pnpm test`, touched-file Prettier check, workflow YAML parse, and `git diff --check`; all passed.
- 2026-05-18 13:29 CDT: Opened [#1398](https://github.com/thinkwork-ai/thinkwork/pull/1398) for U5.
- 2026-05-18 13:34 CDT: Required checks passed for [#1398](https://github.com/thinkwork-ai/thinkwork/pull/1398), but the branch was behind `main`; rebased onto `origin/main`, reran focused workflow tests, CLI typecheck, and diff whitespace check, then force-pushed for CI revalidation.
- 2026-05-18 13:40 CDT: Required checks passed again for [#1398](https://github.com/thinkwork-ai/thinkwork/pull/1398): `cla`, `verify`, `lint`, `typecheck`, and `test`.
- 2026-05-18 13:41 CDT: Squash merged [#1398](https://github.com/thinkwork-ai/thinkwork/pull/1398) as `dcf2e21c0b82e9af85b16b53bd17593934bafb68`; remote branch was deleted, local branch/worktree removed, and `main` fast-forwarded.
- 2026-05-18 13:42 CDT: Started U6 in `.Codex/worktrees/enterprise-overlay-u6` on branch `codex/enterprise-overlay-u6`.
- 2026-05-18 13:54 CDT: Implemented U6 overlay schema validation, deterministic apply planning, overlay apply command, generated CI invocation, customer eval/source helpers, and focused CLI/API coverage. Focused CLI/API tests, CLI/API typecheck, CLI build, workflow YAML parse, and `git diff --check` passed.
- 2026-05-18 13:55 CDT: Completed U6 broad local verification: workspace lint, workspace typecheck, full `pnpm test`, touched-file Prettier check, and `git diff --check` passed.
- 2026-05-18 13:58 CDT: Opened [#1400](https://github.com/thinkwork-ai/thinkwork/pull/1400) for U6.
- 2026-05-18 14:03 CDT: Required checks passed for [#1400](https://github.com/thinkwork-ai/thinkwork/pull/1400), but the branch was behind `main`; rebased onto `origin/main`, then reran focused CLI/API tests, CLI/API typecheck, CLI build, workflow YAML parse, and `git diff --check`.
- 2026-05-18 14:08 CDT: Required checks passed again for [#1400](https://github.com/thinkwork-ai/thinkwork/pull/1400): `cla`, `verify`, `lint`, `typecheck`, and `test`.
- 2026-05-18 14:08 CDT: Squash merged [#1400](https://github.com/thinkwork-ai/thinkwork/pull/1400) as `1d9af8727735e9a4e0201247f6d2826ce1963b18`; remote branch was already deleted by GitHub, local branch/worktree removed, and `main` fast-forwarded.
- 2026-05-18 14:09 CDT: Started U7 in `.Codex/worktrees/enterprise-docs-smoke-u7` on branch `codex/enterprise-docs-smoke-u7`.
- 2026-05-18 14:18 CDT: Implemented U7 deploy docs, overlay contract docs, generated repo runbook, enterprise template smoke script, sidebar/CLI references, and docs link coverage. Smoke script, focused CLI tests, docs build, CLI typecheck/build, workspace lint, workspace typecheck, full `pnpm test`, touched-file Prettier write, and `git diff --check` passed.
- 2026-05-18 14:21 CDT: Opened [#1401](https://github.com/thinkwork-ai/thinkwork/pull/1401) for U7.
- 2026-05-18 14:26 CDT: Required checks passed for [#1401](https://github.com/thinkwork-ai/thinkwork/pull/1401): `cla`, `verify`, `lint`, `typecheck`, and `test`.
- 2026-05-18 14:26 CDT: Squash merged [#1401](https://github.com/thinkwork-ai/thinkwork/pull/1401) as `4580ddebbabfc5fecbe1fae6af9f76061fdd303e`; remote branch was already deleted by GitHub, local branch/worktree removed, and `main` fast-forwarded.
- 2026-05-18 14:27 CDT: Completed all enterprise customer deployment repo implementation units from U1 through U7.

### Blockers

- None at this time.

---

## Current Run: Requester Idle Memory Learning

Plan: `docs/plans/2026-05-18-001-feat-requester-idle-memory-learning-plan.md`

Requirements: `docs/brainstorms/2026-05-18-requester-idle-memory-learning-requirements.md`

Target branch: `main`

### Current Unit

- Active unit: none - requester idle memory learning completed
- Active branch: none
- Active worktree: none
- Started: 2026-05-18
- PR: [#1388](https://github.com/thinkwork-ai/thinkwork/pull/1388)
- CI: passed

### Progress Log

| Date       | Unit                        | Branch                                 | PR                                                           | Status | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                     |
| ---------- | --------------------------- | -------------------------------------- | ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-18 | Slice A (`U1`-`U3`)         | `codex/requester-idle-memory-learning` | [#1382](https://github.com/thinkwork-ai/thinkwork/pull/1382) | Merged | `pnpm --filter @thinkwork/api test -- scheduled-jobs.computer-id.test.ts thread-idle-memory-learning.test.ts activity.test.ts thread-attachments-finalize.test.ts`; `pnpm --filter @thinkwork/lambda test -- job-trigger.skill-run.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/database-pg typecheck`; `bash scripts/build-lambdas.sh job-trigger`; `bash scripts/build-lambdas.sh thread-idle-memory-learning`; `terraform fmt terraform/modules/app/lambda-api/handlers.tf terraform/modules/app/lambda-api/main.tf`; `git diff --check`; `psql ... -f packages/database-pg/drizzle/0099_thread_idle_learning.sql` against dev; `bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0099_thread_idle_learning.sql`; GitHub checks                                                                                                                                                                                                                                                                                                                                                                               | Grouped U1-U3 per plan's recommended Slice A because schema, activity scheduling, and stale/no-op fire path are tightly coupled and feature-flagged off by default. Squash merged as `c2d0489cdd36c14bfe77dbfd26ebfbd57bcee7e7`; deleted the remote/local branch and worktree.                                            |
| 2026-05-18 | Slice B (`U4`-`U5` partial) | `codex/requester-memory-slice-b`       | [#1383](https://github.com/thinkwork-ai/thinkwork/pull/1383) | Merged | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/storage.test.ts src/lib/requester-memory/safety.test.ts src/lib/requester-memory/learner.test.ts src/handlers/thread-idle-memory-learning.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/lambda test -- job-trigger.skill-run.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `bash scripts/build-lambdas.sh thread-idle-memory-learning`; `bash scripts/build-lambdas.sh job-trigger`; `git diff --check`; GitHub checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Implemented requester-scoped S3 memory storage, snapshot/restore helpers, deterministic safety filters, candidate staging to `memory/candidates/YYYY-MM-DD.md`, and internal idle-learning reports. Squash merged as `b946922d1573538fb7ec7b56d88402b5744d9fe7`; deleted the remote/local branch and worktree.            |
| 2026-05-18 | Slice C (`U5`+`U6`)         | `codex/requester-memory-slice-c`       | [#1384](https://github.com/thinkwork-ai/thinkwork/pull/1384) | Merged | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/storage.test.ts src/lib/requester-memory/safety.test.ts src/lib/requester-memory/learner.test.ts src/lib/requester-memory/hindsight-sync.test.ts src/lib/memory/adapters/hindsight-adapter.test.ts src/handlers/thread-idle-memory-learning.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/api test`; `bash scripts/build-lambdas.sh thread-idle-memory-learning`; `git diff --check`; GitHub checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Added strong-evidence durable promotion to `memory/MEMORY.md` and stable Hindsight replace upserts for durable requester memory markdown. Squash merged as `d276f8987edf760a851c7eab170a5f5350d37235`; deleted the remote/local branch and worktree.                                                                      |
| 2026-05-18 | Slice D (`U7`+`U8` partial) | `codex/requester-memory-slice-d`       | [#1386](https://github.com/thinkwork-ai/thinkwork/pull/1386) | Merged | `pnpm --filter @thinkwork/api test -- src/lib/computers/runtime-api.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `uv run --with botocore --with pytest python -m pytest packages/agentcore-strands/agent-container/test_knowledge_pack_loader.py packages/agentcore-strands/agent-container/test_server_chat_handler_retain.py`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/computer-runtime test -- src/computer-chat.test.ts src/task-loop.test.ts`; `pnpm --filter @thinkwork/computer-runtime typecheck`; `pnpm --filter @thinkwork/computer-runtime test`; `uv run --with ruff ruff check --select F821 packages/agentcore-strands/agent-container/container-sources/server.py packages/agentcore-strands/agent-container/test_knowledge_pack_loader.py packages/agentcore-strands/agent-container/test_server_chat_handler_retain.py`; `python -m py_compile packages/agentcore-strands/agent-container/container-sources/server.py packages/agentcore-strands/agent-container/test_knowledge_pack_loader.py packages/agentcore-strands/agent-container/test_server_chat_handler_retain.py`; `git diff --check`; GitHub checks | Added requester overlay text to shared Computer turn prompts, let the runtime suppress workspace `USER.md` for shared Computer turns, and skipped raw full-thread retain when idle memory learning is enabled. Squash merged as `63f09498626a22f82bacb07e668b1d3f8ebabce0`; deleted the remote/local branch and worktree. |
| 2026-05-18 | Slice E (`U8`)              | `codex/requester-memory-slice-e`       | [#1388](https://github.com/thinkwork-ai/thinkwork/pull/1388) | Merged | `pnpm schema:build`; `pnpm --filter @thinkwork/admin codegen`; `pnpm --filter @thinkwork/mobile codegen`; `pnpm --filter thinkwork-cli codegen`; `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/storage.test.ts src/lib/requester-memory/rollback.test.ts src/__tests__/graphql-contract.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/admin build`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/database-pg typecheck`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm --filter @thinkwork/admin test`; `pnpm --filter @thinkwork/mobile test`; `git diff --check`; GitHub checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Added idle-learning run list/detail, requester-scoped rollback from snapshots, Hindsight re-sync after rollback, and minimal admin status/rollback controls. Squash merged as `ea4704ff662b5e6c01e4d6d1ead8a89714675897`; deleted the remote/local branch and worktree.                                                   |

### CI / Merge Log

- Started Slice A in `.Codex/worktrees/requester-idle-memory-learning` on branch `codex/requester-idle-memory-learning`.
- Implemented the idle-learning state/run schema, internal scheduled-job filtering, feature-flagged Thread activity scheduling helper, activity hooks for user messages/assistant responses/finalized attachments, `job-trigger` stale guard, and an inert `thread-idle-memory-learning` worker shell.
- Opened draft [#1382](https://github.com/thinkwork-ai/thinkwork/pull/1382).
- First CI run passed `cla`, `lint`, `verify`, `typecheck`, and `test`; `Migration Drift Precheck (dev)` failed because `0099_thread_idle_learning.sql` markers were missing from dev.
- First local dev migration attempt failed before connecting because AWS CLI region was unset; reran with `AWS_REGION=us-east-1` and `AWS_DEFAULT_REGION=us-east-1`.
- Applied `packages/database-pg/drizzle/0099_thread_idle_learning.sql` to dev and verified the scoped drift reporter returned all markers present.
- Required checks passed after the migration drift rerun.
- Squash merged [#1382](https://github.com/thinkwork-ai/thinkwork/pull/1382) as `c2d0489cdd36c14bfe77dbfd26ebfbd57bcee7e7`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the remote/local branch and worktree, then fast-forwarded `main`.
- Started Slice B in `.Codex/worktrees/requester-memory-slice-b` on branch `codex/requester-memory-slice-b`.
- The first focused test attempt failed because the new worktree lacked `node_modules`; ran `pnpm install --frozen-lockfile`, then focused requester-memory tests passed.
- Required checks for [#1383](https://github.com/thinkwork-ai/thinkwork/pull/1383) passed.
- Squash merged [#1383](https://github.com/thinkwork-ai/thinkwork/pull/1383) as `b946922d1573538fb7ec7b56d88402b5744d9fe7`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the remote/local branch and worktree, then fast-forwarded `main`.
- Started Slice C in `.Codex/worktrees/requester-memory-slice-c` on branch `codex/requester-memory-slice-c`.
- Required checks for [#1384](https://github.com/thinkwork-ai/thinkwork/pull/1384) passed.
- Squash merged [#1384](https://github.com/thinkwork-ai/thinkwork/pull/1384) as `d276f8987edf760a851c7eab170a5f5350d37235`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the remote/local branch and worktree, then fast-forwarded `main`.
- Started Slice D in `.Codex/worktrees/requester-memory-slice-d` on branch `codex/requester-memory-slice-d`.
- Completed Slice D local implementation and verification; preparing the branch for PR.
- Opened [#1386](https://github.com/thinkwork-ai/thinkwork/pull/1386).
- Required checks for [#1386](https://github.com/thinkwork-ai/thinkwork/pull/1386) passed; rebased onto current `origin/main`, reran focused local checks, and required checks passed again.
- Squash merged [#1386](https://github.com/thinkwork-ai/thinkwork/pull/1386) as `63f09498626a22f82bacb07e668b1d3f8ebabce0`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the remote/local branch and worktree, then fast-forwarded `main`.
- Started Slice E in `.Codex/worktrees/requester-memory-slice-e` on branch `codex/requester-memory-slice-e`.
- Completed Slice E local implementation and verification; preparing the branch for PR.
- Opened [#1388](https://github.com/thinkwork-ai/thinkwork/pull/1388).
- Required checks for [#1388](https://github.com/thinkwork-ai/thinkwork/pull/1388) passed; the first merge attempt was rejected because the PR became behind `main` after [#1387](https://github.com/thinkwork-ai/thinkwork/pull/1387) merged.
- Rebased [#1388](https://github.com/thinkwork-ai/thinkwork/pull/1388) onto current `origin/main`, reran focused requester-memory API tests and the admin build, force-pushed, and required checks passed again.
- Squash merged [#1388](https://github.com/thinkwork-ai/thinkwork/pull/1388) as `ea4704ff662b5e6c01e4d6d1ead8a89714675897`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the remote/local branch and worktree, then fast-forwarded `main`.
- Completed all requester idle memory learning implementation units from U1 through U8.

### Blockers

- None at this time.

---

## Current Run: Business Ontology Change Sets

Plan: `docs/plans/2026-05-17-002-feat-business-ontology-change-sets-plan.md`

Requirements: `docs/brainstorms/2026-05-17-business-ontology-change-sets-requirements.md`

Target branch: `main`

### Current Unit

- Active unit: none - business ontology change sets completed
- Active branch: none
- Active worktree: none
- Started: 2026-05-17
- PR: [#1357](https://github.com/thinkwork-ai/thinkwork/pull/1357)
- CI: passed

### Progress Log

| Date       | Unit | Branch                              | PR                                                           | Status | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ---- | ----------------------------------- | ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-17 | U1   | `codex/ontology-u1-schema`          | [#1332](https://github.com/thinkwork-ai/thinkwork/pull/1332) | Merged | `pnpm schema:build`; `pnpm --filter @thinkwork/database-pg test -- schema-ontology.test.ts`; `pnpm --filter @thinkwork/api test -- src/__tests__/graphql-contract.test.ts`; `pnpm --filter @thinkwork/database-pg test`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/database-pg typecheck`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm -r --if-present test`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                      | Added the `ontology.*` schema foundation, idempotent tenant seed migration, canonical GraphQL ontology contract, and schema/migration coverage. Squash merged as `7982cf5126d36f54bdcf1f2b6792d230dbee6750`; deleted the remote/local branch and worktree.                                                                                                           |
| 2026-05-17 | U2   | `codex/ontology-u2-api`             | [#1340](https://github.com/thinkwork-ai/thinkwork/pull/1340) | Merged | `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/ontology/ontology.test.ts src/lib/ontology/repository.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api test -- src/__tests__/graphql-contract.test.ts`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                   | Added the tenant-admin ontology repository, change-set review GraphQL resolvers, suggestion scan/reprocess job API surface, enum coercion guards, active-definition mapping filtering, and focused resolver/repository coverage. Squash merged as `c93886b99400579ec9279976657e1c30a2f8c14c`; deleted the remote/local branch and worktree.                          |
| 2026-05-17 | U3   | `codex/ontology-u3-suggestions`     | [#1346](https://github.com/thinkwork-ai/thinkwork/pull/1346) | Merged | `pnpm --filter @thinkwork/api test -- src/lib/ontology/suggestions.test.ts src/handlers/ontology-scan.test.ts src/graphql/resolvers/ontology/startOntologySuggestionScan.mutation.test.ts src/graphql/resolvers/ontology/ontology.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `bash scripts/build-lambdas.sh ontology-scan`; `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf terraform/modules/app/lambda-api/main.tf`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                     | Added durable ontology suggestion scan jobs, async Lambda dispatch, deterministic and LLM synthesis, evidence compaction, standards mapping metadata, open-draft dedupe/replacement, scan metrics/degradation reporting, and Terraform Lambda/DLQ wiring. Squash merged as `657648381c3aaaa8837f85eac6307931abda6bc8`; deleted the remote/local branch and worktree. |
| 2026-05-17 | U4   | `codex/ontology-u4-reprocess`       | [#1350](https://github.com/thinkwork-ai/thinkwork/pull/1350) | Merged | `pnpm --filter @thinkwork/api test -- src/lib/ontology/reprocess.test.ts src/handlers/ontology-reprocess.test.ts src/graphql/resolvers/ontology/ontology.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `bash scripts/build-lambdas.sh ontology-reprocess`; `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf terraform/modules/app/lambda-api/main.tf`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                         | Added ontology reprocess queue/claim/runner logic, impact analysis metrics, approved-definition application, approval-time async invoke, ontology-reprocess Lambda handler, and Terraform Lambda/DLQ wiring. Squash merged as `d780c022623b37572623ad55fd5f083dcc3c0c29`; deleted the remote/local branch and worktree.                                              |
| 2026-05-17 | U5   | `codex/ontology-u5-brain-templates` | [#1351](https://github.com/thinkwork-ai/thinkwork/pull/1351) | Merged | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/api test -- src/lib/ontology/templates.test.ts src/lib/ontology/materializer.test.ts src/lib/ontology/reprocess.test.ts src/__tests__/wiki-compiler.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `bash scripts/build-lambdas.sh ontology-reprocess`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                | Added ontology template resolution, Brain materializer draft logic, source-less write rejection, higher-trust section preservation, reprocess materialization integration, and wiki planner/writer ontology guardrails. Squash merged as `c0ecf7ce31a3fb69638702b2546eb5e6dd33780a`; deleted the remote/local branch and worktree.                                   |
| 2026-05-17 | U6   | `codex/ontology-u6-context-engine`  | [#1353](https://github.com/thinkwork-ai/thinkwork/pull/1353) | Merged | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/api test -- src/lib/context-engine src/handlers/mcp-context-engine.requester-context.test.ts`; `pnpm --filter @thinkwork/admin test -- src/routes/_authed/_tenant/knowledge/-context-engine-sources.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/react-native-sdk typecheck`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `bash scripts/build-lambdas.sh mcp-context-engine`; `pnpm --filter @thinkwork/admin build`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run | Added ontology-aware tenant Brain context retrieval, structured facet/provenance metadata, direct `query_brain_context` agent tool routing, Brain source-family propagation for memory bridge hits, and Context Engine provider selection coverage. Squash merged as `466143e9d30eac61aceaa4fe36a3ce922d3b0117`; deleted the remote/local branch and worktree.       |
| 2026-05-17 | U7   | `codex/ontology-u7-admin-studio`    | [#1355](https://github.com/thinkwork-ai/thinkwork/pull/1355) | Merged | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/admin codegen`; `pnpm --filter @thinkwork/admin test -- src/routes/_authed/_tenant/-ontology-route.test.tsx src/routes/_authed/_tenant/-ontology-change-set.test.tsx src/routes/_authed/_tenant/agent-templates/-template-kind.test.ts`; `pnpm --filter @thinkwork/admin test`; `pnpm --filter @thinkwork/admin build`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm -r --if-present test`; `git diff --check`; touched-file Prettier check; Vite `/ontology` HTTP smoke; GitHub checks; post-merge Deploy run                                                               | Added the Manage-section Ontology Studio UI for scanning, reviewing, editing, approving/rejecting change sets, mappings, and reprocess job monitoring. Squash merged as `b119687f6c018cc69ec82fcffe940ca9a69ba5d5`; deleted the remote/local branch and worktree.                                                                                                    |
| 2026-05-17 | U8   | `codex/ontology-u8-docs-ops`        | [#1357](https://github.com/thinkwork-ai/thinkwork/pull/1357) | Merged | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/docs build`; touched-file Prettier check; `git diff --check`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm -r --if-present test`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                       | Documented the ontology model, operator workflow, reprocess behavior, Context Engine/GraphQL surface, rollout guardrails, and reusable change-set-loop best practice. Squash merged as `054deb20b0af37396b846381506c4d58976bd032`; deleted the remote/local branch and worktree.                                                                                     |

### CI / Merge Log

- Started U1 in `.Codex/worktrees/ontology-u1` on branch `codex/ontology-u1-schema`.
- Copied the business ontology plan and brainstorm requirements into the branch because they were not yet present on `origin/main`.
- Completed U1 local implementation and verification; preparing the branch for PR.
- Opened [#1332](https://github.com/thinkwork-ai/thinkwork/pull/1332) for U1.
- First CI run: `cla`, `lint`, `typecheck`, and `verify` passed; `Migration Drift Precheck (dev)` failed because `0098_business_ontology.sql` had not yet been applied to dev.
- Applied `packages/database-pg/drizzle/0098_business_ontology.sql` to dev and verified the scoped drift reporter returned all markers present. Removed the unsupported schema-level `-- creates: ontology` marker so the reporter checks the table/index/constraint objects, matching prior schema extraction migrations.
- Rerun GitHub checks passed for [#1332](https://github.com/thinkwork-ai/thinkwork/pull/1332); preparing to squash merge.
- Squash merged [#1332](https://github.com/thinkwork-ai/thinkwork/pull/1332) as `7982cf5126d36f54bdcf1f2b6792d230dbee6750`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U1 remote/local branch and worktree.
- Watched post-merge Deploy run `25994933925`, which passed.
- Started U2 in `.Codex/worktrees/ontology-u2-api` on branch `codex/ontology-u2-api`.
- Completed U2 local implementation and verification; preparing the branch for PR.
- Opened [#1340](https://github.com/thinkwork-ai/thinkwork/pull/1340) for U2.
- Required checks passed for [#1340](https://github.com/thinkwork-ai/thinkwork/pull/1340); the branch became behind `main`, so it was rebased, focused local checks passed again, and required checks passed after the force-push.
- Squash merged [#1340](https://github.com/thinkwork-ai/thinkwork/pull/1340) as `c93886b99400579ec9279976657e1c30a2f8c14c`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U2 remote/local branch and worktree.
- Watched post-merge Deploy run `25995963370`, which passed.
- Started U3 in `.Codex/worktrees/ontology-u3-suggestions` on branch `codex/ontology-u3-suggestions`.
- Completed U3 local implementation and verification; preparing the branch for PR.
- Opened [#1346](https://github.com/thinkwork-ai/thinkwork/pull/1346) for U3.
- Required checks passed for [#1346](https://github.com/thinkwork-ai/thinkwork/pull/1346); the branch was rebased repeatedly while other PRs landed on `main`, with focused local checks rerun after each rebase.
- Squash merged [#1346](https://github.com/thinkwork-ai/thinkwork/pull/1346) as `657648381c3aaaa8837f85eac6307931abda6bc8`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U3 remote/local branch and worktree.
- Watched post-merge Deploy run `25997206450`, which passed.
- Started U4 in `.Codex/worktrees/ontology-u4-reprocess` on branch `codex/ontology-u4-reprocess`.
- Completed U4 local implementation and verification; preparing the branch for PR.
- Opened [#1350](https://github.com/thinkwork-ai/thinkwork/pull/1350) for U4.
- Required checks passed for [#1350](https://github.com/thinkwork-ai/thinkwork/pull/1350).
- Squash merged [#1350](https://github.com/thinkwork-ai/thinkwork/pull/1350) as `d780c022623b37572623ad55fd5f083dcc3c0c29`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U4 remote/local branch and worktree.
- Watched post-merge Deploy run `25997882273`, which passed.
- Started U5 in `.Codex/worktrees/ontology-u5-brain-templates` on branch `codex/ontology-u5-brain-templates`.
- Completed U5 implementation and local verification; preparing the branch for PR.
- Opened [#1351](https://github.com/thinkwork-ai/thinkwork/pull/1351) for U5.
- Required checks passed for [#1351](https://github.com/thinkwork-ai/thinkwork/pull/1351).
- Squash merged [#1351](https://github.com/thinkwork-ai/thinkwork/pull/1351) as `c0ecf7ce31a3fb69638702b2546eb5e6dd33780a`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U5 remote/local branch and worktree.
- Watched post-merge Deploy run `25998535771`, which passed.
- Started U6 in `.Codex/worktrees/ontology-u6-context-engine` on branch `codex/ontology-u6-context-engine`.
- Completed U6 implementation and local verification; preparing the branch for PR.
- Opened [#1353](https://github.com/thinkwork-ai/thinkwork/pull/1353) for U6.
- Required checks passed for [#1353](https://github.com/thinkwork-ai/thinkwork/pull/1353); the branch was behind `main`, so it was rebased and focused local checks passed again before force-push.
- Required checks passed again for [#1353](https://github.com/thinkwork-ai/thinkwork/pull/1353).
- Squash merged [#1353](https://github.com/thinkwork-ai/thinkwork/pull/1353) as `466143e9d30eac61aceaa4fe36a3ce922d3b0117`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U6 remote/local branch and worktree.
- Watched post-merge Deploy run `25999344408`, which passed.
- Started U7 in `.Codex/worktrees/ontology-u7-admin-studio` on branch `codex/ontology-u7-admin-studio`.
- Implemented the U7 Ontology Studio route, Manage sidebar entry, GraphQL admin operations, generated route tree/client artifacts, and focused admin tests.
- Completed U7 local verification: focused admin ontology tests, full admin tests, admin production build, repo typecheck/lint/test, diff whitespace check, touched-file Prettier check, and a Vite `/ontology` HTTP smoke all passed. Preparing PR.
- Opened [#1355](https://github.com/thinkwork-ai/thinkwork/pull/1355) for U7.
- Required checks passed for [#1355](https://github.com/thinkwork-ai/thinkwork/pull/1355).
- Squash merged [#1355](https://github.com/thinkwork-ai/thinkwork/pull/1355) as `b119687f6c018cc69ec82fcffe940ca9a69ba5d5`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U7 remote/local branch and worktree.
- Watched post-merge Deploy run `26000110062`, which passed.
- Started U8 in `.Codex/worktrees/ontology-u8-docs-ops` on branch `codex/ontology-u8-docs-ops`.
- Updated the U8 docs set for the business ontology concept, operator runbook, Admin Ontology page, Context Engine/API docs, knowledge graph direction, page/pipeline docs, and reusable best-practice solution note.
- Completed U8 local verification: docs build, touched-file Prettier check, diff whitespace check, repo typecheck, repo lint, and repo test all passed. Preparing PR.
- Opened [#1357](https://github.com/thinkwork-ai/thinkwork/pull/1357) for U8.
- Required checks passed for [#1357](https://github.com/thinkwork-ai/thinkwork/pull/1357); the branch was behind `main`, so it was rebased, docs build/format/diff checks passed again, and required checks passed after the force-push.
- A second status-ledger conflict appeared after the shared-computers closeout landed on `main`; rebased again, resolved the ledger conflict by keeping U7/U8 ontology status plus the completed shared-computers section, and docs build/format/diff checks passed again before force-push.
- Required checks passed again for [#1357](https://github.com/thinkwork-ai/thinkwork/pull/1357).
- Squash merged [#1357](https://github.com/thinkwork-ai/thinkwork/pull/1357) as `054deb20b0af37396b846381506c4d58976bd032`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U8 remote/local branch and worktree.
- Watched post-merge Deploy run `26000927848`, which passed.
- Completed all business ontology change-set implementation units from U1 through U8.

### Blockers

- None.

---

## Current Run: Shared Computers Product Reframe

Plan: `docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md`

Target branch: `main`

### Current Unit

- Active unit: none - shared Computers product reframe completed
- Active branch: none
- Active worktree: none
- Started: 2026-05-17
- PR: [#1356](https://github.com/thinkwork-ai/thinkwork/pull/1356)
- CI: passed

### Progress Log

| Date       | Unit           | Branch                                          | PR                                                           | Status | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------- | ----------------------------------------------- | ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-17 | U1             | `codex/shared-computers-u1-schema`              | [#1322](https://github.com/thinkwork-ai/thinkwork/pull/1322) | Merged | `pnpm schema:build`; GraphQL codegen for admin/mobile/CLI; `pnpm --filter @thinkwork/database-pg test`; `pnpm --filter @thinkwork/database-pg typecheck`; `bash scripts/db-migrate-manual.sh --dry-run packages/database-pg/drizzle/0097_shared_computers.sql`; `pnpm --filter @thinkwork/api typecheck`; focused API compatibility tests; `pnpm --filter @thinkwork/lambda typecheck`; focused Lambda test; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/mobile test`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present test`; `git diff --check`; GitHub checks | Created isolated worktree from `origin/main`, copied the approved plan/brainstorm docs into the branch, added shared Computer schema/assignment migration, regenerated GraphQL clients, and added nullable-owner compatibility guards for legacy owner-scoped runtime paths. Squash merged as `e13db6b217f19283e8c26dd671f91b55d27b086c`; deleted the remote/local branch and worktree.                                                                                                                                                                        |
| 2026-05-17 | U2             | `codex/shared-computers-u2-graphql`             | [#1325](https://github.com/thinkwork-ai/thinkwork/pull/1325) | Merged | `pnpm schema:build`; GraphQL codegen for admin/mobile/CLI; `pnpm --filter @thinkwork/api typecheck`; focused API resolver and GraphQL contract tests; `pnpm --filter @thinkwork/api test`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present test`; `pnpm -r --if-present lint`; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                        | Added shared Computer assignment GraphQL queries/mutations, assignment-aware read access, assigned Computer listing, and generated client types for admin/mobile/CLI. Squash merged as `d5425bf33ec441969152bd2beeaedb98e5669b54`; deleted the remote/local branch and worktree.                                                                                                                                                                                                                                                                               |
| 2026-05-17 | U3             | `codex/shared-computers-u3-runtime-envelope`    | [#1329](https://github.com/thinkwork-ai/thinkwork/pull/1329) | Merged | Focused API/runtime/Lambda/Python tests; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/computer-runtime test`; `pnpm --filter @thinkwork/lambda test`; `uv run pytest packages/agentcore-strands/agent-container/test_computer_task_events.py packages/agentcore-strands/agent-container/test_computer_thread_response.py`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present test`; `pnpm -r --if-present lint`; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                      | Propagated requester identity through thread turns, task claiming, runtime context, audit events, Google Workspace credential resolution, and scheduled Computer dispatch. Squash merged as `a807035f4f88e5052e353c7a2e40504418b4d59a`; deleted the remote/local branch and worktree.                                                                                                                                                                                                                                                                          |
| 2026-05-17 | Plan amendment | `codex/shared-computers-option-a-plan`          | [#1333](https://github.com/thinkwork-ai/thinkwork/pull/1333) | Merged | `pnpm install --frozen-lockfile`; `pnpm dlx prettier@3.5.3 --check docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md docs/plans/autopilot-status.md`; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                           | Added Option A to the shared Computers plan: user-owned Gmail/Google Calendar connector event triggers route to assigned shared Computers with explicit requester and credential-subject attribution, without reintroducing personal Computers. Squash merged as `95e3e33ac318e0823532c71170cbcd8355805cd8`; deleted the remote/local branch and worktree.                                                                                                                                                                                                     |
| 2026-05-17 | U4             | `codex/shared-computers-u4-requester-context`   | [#1337](https://github.com/thinkwork-ai/thinkwork/pull/1337) | Merged | Focused API requester-context/MCP/memory/runtime tests; focused computer-runtime prompt test; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/computer-runtime typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/computer-runtime test`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; touched-file Prettier check; `git diff --check`; `pnpm -r --if-present test`; GitHub checks; post-merge Deploy run                                                                                                                                                                | Added requester-scoped personal memory overlay for shared Computer turns, Context Engine MCP calls, GraphQL memory search provenance, and computer-runtime prompt assembly. Squash merged as `4b9c76cdb12046da6dda84d3c196e47bfd3f1656`; deleted the remote/local branch and worktree.                                                                                                                                                                                                                                                                         |
| 2026-05-17 | U4A            | `codex/shared-computers-u4a-connector-triggers` | [#1344](https://github.com/thinkwork-ai/thinkwork/pull/1344) | Merged | `pnpm install --frozen-lockfile`; `pnpm schema:build`; GraphQL codegen for admin/mobile/CLI; focused API connector trigger/task-envelope tests; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/skill-catalog test`; `pnpm --filter @thinkwork/admin build`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm -r --if-present test`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                | Added user-owned connector trigger definitions that validate exact active connection ownership and shared Computer requester access, route connector events to Computer task queues with requester/credential-subject provenance, expose connection-scoped trigger listing, and preserve connector event envelopes. Hardened two workload-sensitive test files with narrow timeouts so the full workspace test run is stable under concurrent load. Squash merged as `96d3153845b544575ab27e05213ca18d29393bf3`; deleted the remote/local branch and worktree. |
| 2026-05-17 | U5             | `codex/shared-computers-u5-app-mobile`          | [#1348](https://github.com/thinkwork-ai/thinkwork/pull/1348) | Merged | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/mobile codegen`; focused Computer app route/hook tests; focused mobile thread query test; `pnpm --filter @thinkwork/computer typecheck`; `pnpm --filter @thinkwork/computer test`; `pnpm --filter @thinkwork/mobile test`; `pnpm --filter @thinkwork/computer build`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `git diff --check`; touched-file Prettier check; Playwright smoke of `http://localhost:5174/`; `pnpm -r --if-present test`; GitHub checks; post-merge Deploy run                                                                      | Replaced Computer app and mobile `myComputer`-centric flows with `assignedComputers`, added assigned-Computer selection and no-assignment fail-closed states, persisted the selected mobile Computer per tenant, and updated automation detail/edit flows to resolve the assigned shared Computer for the job. Squash merged as `c95448108e4b4b2f0b3cfd9db7b736a3bdbf449f`; deleted the remote/local branch and worktree.                                                                                                                                      |
| 2026-05-17 | U6             | `codex/shared-computers-u6-admin-assignments`   | [#1352](https://github.com/thinkwork-ai/thinkwork/pull/1352) | Merged | `pnpm install --frozen-lockfile`; `pnpm --filter @thinkwork/admin codegen`; focused admin assignment tests; `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/admin test`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm -r --if-present test`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                           | Added Admin shared Computer creation without owner selection, initial direct user/Team assignment, Computer detail assignment controls, Computer detail effective-access DataTable, and People detail direct Computer assignment controls. Squash merged as `6cd1db9f58f4a7f970e6a545ac93e396299ec98e`; deleted the remote/local branch and worktree.                                                                                                                                                                                                          |
| 2026-05-17 | U7             | `codex/shared-computers-u7-slack-contract`      | [#1354](https://github.com/thinkwork-ai/thinkwork/pull/1354) | Merged | `pnpm install --frozen-lockfile`; focused API Slack targeting/handler tests; focused Slack acceptance test; focused Lambda Slack dispatch test; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/docs build`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/lambda test`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `bash scripts/build-lambdas.sh slack-dispatch`; `pnpm -r --if-present test`; focused Slack interactivity regression; touched-file Prettier check; `git diff --check`; GitHub checks; post-merge Deploy run   | Rewrote Slack invocation around assigned shared Computers, explicit target selection, requester attribution, and no personal Computer fallback. Squash merged as `31dc294d546ad31db22084193c43aff55ac52d2f`; deleted the remote/local branch and worktree.                                                                                                                                                                                                                                                                                                     |
| 2026-05-17 | U8             | `codex/shared-computers-u8-sweep`               | [#1356](https://github.com/thinkwork-ai/thinkwork/pull/1356) | Merged | `pnpm install --frozen-lockfile`; GraphQL codegen for admin/mobile; focused API/admin/mobile/computer/graph tests and typechecks; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/computer typecheck`; `pnpm --filter @thinkwork/computer build`; `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/docs build`; `pnpm -r --if-present typecheck`; `pnpm -r --if-present lint`; `pnpm -r --if-present test`; `pnpm --filter @thinkwork/workspace-defaults test`; touched-file Prettier check; `git diff --check`; GitHub checks; post-merge Deploy run                                             | Updated active product/docs/workspace-default language to shared Computers, removed `MyComputerQuery` from user-facing admin/mobile/computer clients, defaulted memory/wiki requester scope to the authenticated requester rather than a personal Computer owner, regenerated admin/mobile GraphQL clients, and added requester-scope/contract tests. Squash merged as `d222abf3acf78f2fd692094268916eef43a192a6`; deleted the remote/local branch and worktree.                                                                                               |

### CI / Merge Log

- Opened [#1322](https://github.com/thinkwork-ai/thinkwork/pull/1322).
- First CI run passed `cla`, `lint`, `verify`, `typecheck`, and `test`; `Migration Drift Precheck (dev)` failed because `0097_shared_computers.sql` had not yet been applied to dev.
- Applied `packages/database-pg/drizzle/0097_shared_computers.sql` to dev and verified the scoped drift reporter returned all markers present.
- Reran the failed migration drift precheck; it passed.
- Rebased [#1322](https://github.com/thinkwork-ai/thinkwork/pull/1322) onto current `origin/main`, reran focused local checks, and required GitHub checks passed again.
- Squash merged [#1322](https://github.com/thinkwork-ai/thinkwork/pull/1322) as `e13db6b217f19283e8c26dd671f91b55d27b086c`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U1 remote/local branch and worktree.
- Started U2 in `.Codex/worktrees/shared-computers-u2-graphql` on branch `codex/shared-computers-u2-graphql`.
- Completed U2 local implementation and verification; preparing the branch for PR.
- Opened [#1325](https://github.com/thinkwork-ai/thinkwork/pull/1325) for U2.
- Rebased [#1325](https://github.com/thinkwork-ai/thinkwork/pull/1325) onto current `origin/main`, reran focused local checks, and required GitHub checks passed again.
- Squash merged [#1325](https://github.com/thinkwork-ai/thinkwork/pull/1325) as `d5425bf33ec441969152bd2beeaedb98e5669b54`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U2 remote/local branch and worktree.
- Watched post-merge Deploy run `25992963189`, which passed.
- Started U3 in `.Codex/worktrees/shared-computers-u3-runtime-envelope` on branch `codex/shared-computers-u3-runtime-envelope`.
- Completed U3 local implementation and verification; preparing the branch for PR.
- Opened [#1329](https://github.com/thinkwork-ai/thinkwork/pull/1329) for U3.
- Required checks for [#1329](https://github.com/thinkwork-ai/thinkwork/pull/1329) passed; rebased onto current `origin/main` after the PR became behind, reran focused local checks plus repo typecheck, force-pushed, and required checks passed again.
- Squash merged [#1329](https://github.com/thinkwork-ai/thinkwork/pull/1329) as `a807035f4f88e5052e353c7a2e40504418b4d59a`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U3 remote/local branch and worktree.
- Watched post-merge Deploy run `25994007083`, which passed.
- Started a plan-amendment branch in `.Codex/worktrees/shared-computers-option-a-plan` after product feedback selected Option A for personal connector triggers to shared Computers.
- Opened [#1333](https://github.com/thinkwork-ai/thinkwork/pull/1333) for the Option A plan amendment.
- Required checks for [#1333](https://github.com/thinkwork-ai/thinkwork/pull/1333) passed after a rebase onto current `origin/main`.
- Squash merged [#1333](https://github.com/thinkwork-ai/thinkwork/pull/1333) as `95e3e33ac318e0823532c71170cbcd8355805cd8`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the plan-amendment remote/local branch and worktree.
- Watched post-merge Deploy run `25994596550`, which passed.
- Started U4 in `.Codex/worktrees/shared-computers-u4-requester-context` on branch `codex/shared-computers-u4-requester-context`.
- Completed U4 local implementation and verification; preparing the branch for PR.
- Opened [#1337](https://github.com/thinkwork-ai/thinkwork/pull/1337) for U4.
- Squash merged [#1337](https://github.com/thinkwork-ai/thinkwork/pull/1337) as `4b9c76cdb12046da6dda84d3c196e47bfd3f1656`; deleted the U4 remote/local branch and worktree.
- Watched post-merge Deploy run `25995612140`, which passed.
- Started U4A in `.Codex/worktrees/shared-computers-u4a-connector-triggers` on branch `codex/shared-computers-u4a-connector-triggers`.
- Completed U4A local implementation and verification; preparing the branch for PR.
- Opened [#1344](https://github.com/thinkwork-ai/thinkwork/pull/1344) for U4A.
- Required checks for [#1344](https://github.com/thinkwork-ai/thinkwork/pull/1344) passed; rebased twice as `origin/main` advanced, resolving generated GraphQL client overlap by regenerating codegen.
- Squash merged [#1344](https://github.com/thinkwork-ai/thinkwork/pull/1344) as `96d3153845b544575ab27e05213ca18d29393bf3`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U4A remote/local branch and worktree.
- Watched post-merge Deploy run `25996779906`, which passed.
- Started U5 in `.Codex/worktrees/shared-computers-u5-app-mobile` on branch `codex/shared-computers-u5-app-mobile`.
- Completed U5 local implementation and verification; preparing the branch for PR.
- Note: `pnpm --filter @thinkwork/mobile exec tsc --noEmit` was attempted as an extra check and failed on existing mobile-wide type debt outside the changed shared-Computer files. The normal workspace typecheck gate does not include a mobile app typecheck script and passed.
- Opened [#1348](https://github.com/thinkwork-ai/thinkwork/pull/1348) for U5.
- Required checks for [#1348](https://github.com/thinkwork-ai/thinkwork/pull/1348) passed after several clean rebases onto current `origin/main`.
- Squash merged [#1348](https://github.com/thinkwork-ai/thinkwork/pull/1348) as `c95448108e4b4b2f0b3cfd9db7b736a3bdbf449f`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U5 remote/local branch and worktree.
- Watched post-merge Deploy run `25998046462`, which passed.
- Started U6 in `.Codex/worktrees/shared-computers-u6-admin-assignments` on branch `codex/shared-computers-u6-admin-assignments`.
- Completed U6 local implementation and verification; preparing the branch for PR.
- Opened [#1352](https://github.com/thinkwork-ai/thinkwork/pull/1352) for U6.
- Required checks for [#1352](https://github.com/thinkwork-ai/thinkwork/pull/1352) passed.
- Squash merged [#1352](https://github.com/thinkwork-ai/thinkwork/pull/1352) as `6cd1db9f58f4a7f970e6a545ac93e396299ec98e`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U6 remote/local branch and worktree.
- Watched post-merge Deploy run `25998793947`, which passed.
- Started U7 in `.Codex/worktrees/shared-computers-u7-slack-contract` on branch `codex/shared-computers-u7-slack-contract`.
- Fetched `origin/main` and rebased with `--autostash`; `origin/main` was already at the U6 merge commit, and the U7 in-progress Slack edits reapplied cleanly.
- Completed U7 local implementation and verification; preparing the branch for PR.
- Opened [#1354](https://github.com/thinkwork-ai/thinkwork/pull/1354) for U7; watching required checks.
- Required checks for [#1354](https://github.com/thinkwork-ai/thinkwork/pull/1354) passed after a clean rebase onto `origin/main`.
- Squash merged [#1354](https://github.com/thinkwork-ai/thinkwork/pull/1354) as `31dc294d546ad31db22084193c43aff55ac52d2f`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U7 remote/local branch and worktree.
- Watched post-merge Deploy run `25999569203`, which passed.
- Started U8 in `.Codex/worktrees/shared-computers-u8-sweep` on branch `codex/shared-computers-u8-sweep`.
- Pulled/fetched latest `origin/main` before U8 after Slack changes landed; the U8 worktree is based on `31dc294d546ad31db22084193c43aff55ac52d2f`.
- Completed U8 local implementation and verification; preparing the branch for PR.
- Opened [#1356](https://github.com/thinkwork-ai/thinkwork/pull/1356) for U8; watching required checks.
- Rebased [#1356](https://github.com/thinkwork-ai/thinkwork/pull/1356) onto current `origin/main` after Slack/admin changes landed, resolving generated admin GraphQL overlap by regenerating codegen. Required checks passed.
- Squash merged [#1356](https://github.com/thinkwork-ai/thinkwork/pull/1356) as `d222abf3acf78f2fd692094268916eef43a192a6`; the merge command hit the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged. Deleted the U8 remote/local branch and worktree.
- Watched post-merge Deploy run `26000437238`, which passed.
- Completed all implementation units for `docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md`.

### Blockers

- None.

---

## Current Run: ThinkWork Slack Workspace App

Plan: `docs/plans/2026-05-16-004-feat-thinkwork-computer-slack-workspace-app-plan.md`

Target branch: `main`

### Current Unit

- Active unit: none - plan implementation complete
- Active branch: none
- Active worktree: none
- Completed: 2026-05-17

### Progress Log

| Date       | Unit | Branch                                    | PR                                                           | Status | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---- | ----------------------------------------- | ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-16 | U1   | `codex/slack-workspace-u1-schema`         | [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273) | Merged | `pnpm --filter @thinkwork/database-pg test`; `pnpm --filter @thinkwork/database-pg typecheck`; `bash scripts/db-migrate-manual.sh --dry-run packages/database-pg/drizzle/0094_slack_workspace_app.sql`; touched-file Prettier check; dev `psql -f packages/database-pg/drizzle/0094_slack_workspace_app.sql`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                             | Added `slack_workspaces`, `slack_user_links`, and `slack_threads` schema plus migration tests. `db:generate` attempted but Drizzle stopped at an existing interactive schema-conflict prompt before writing files. Migration Drift Precheck initially failed because `0094` had not yet been applied to dev; applied it to dev and reran the failed check. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                           |
| 2026-05-16 | U2   | `codex/slack-workspace-u2-terraform`      | [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) | Merged | `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/lambda test`; targeted Slack Lambda builds; `pnpm build:lambdas`; `terraform -chdir=terraform/examples/greenfield validate`; targeted no-refresh Terraform plan for Slack resources; touched-file Prettier check; `terraform fmt -check`; `bash -n scripts/build-lambdas.sh`; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                 | Added Slack app credentials secret, five Lambda registrations, five public API Gateway routes, build entries, inert handler stubs, and a handler README. Full greenfield plan is not clean locally because this shell lacks Cloudflare credentials and the ignored local tfvars do not mirror deployed custom-domain toggles; targeted Slack plan with `lambda_zips_dir` confirmed the new secret, Lambdas, route integrations, and routes are addressable. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                          |
| 2026-05-16 | U3   | `codex/slack-workspace-u3-signature`      | [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) | Merged | `pnpm --filter @thinkwork/api test -- src/handlers/slack/_shared.test.ts src/lib/slack/workspace-store.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm -r --if-present typecheck`; touched-file Prettier check; `git diff --check`; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                                                        | Added Slack v0 signature verification, replay-window enforcement, retry short-circuiting, workspace lookup dispatch wrapper, and Secrets Manager-backed Slack app/bot-token cache. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-16 | U4   | `codex/slack-workspace-u4-oauth-admin`    | [#1279](https://github.com/thinkwork-ai/thinkwork/pull/1279) | Merged | `pnpm --filter @thinkwork/api test -- src/lib/slack/oauth-state.test.ts src/handlers/slack/oauth-install.test.ts src/graphql/resolvers/slack/slack.resolvers.test.ts src/lib/slack/workspace-store.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm schema:build`; GraphQL codegen for CLI/mobile/admin; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/admin test`; `bash scripts/build-lambdas.sh slack-oauth-install`; `git diff --check`; touched-file Prettier check; Chrome visual check; GitHub checks; post-merge Deploy run                                                                                                                        | Implemented signed Slack OAuth install state, OAuth callback token storage/upsert, Slack workspace GraphQL query/mutations, and admin install/list/uninstall UI. Admin codegen initially failed on an existing remote-Symphony extension GraphQL document; excluded that sample from ThinkWork schema codegen because it targets a separate backend schema. Chrome visual check rendered the Slack page and install dialog; the page showed the expected deployed-schema GraphQL error until this PR reached deploy. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed. |
| 2026-05-16 | U5   | `codex/slack-workspace-u5-user-linking`   | [#1280](https://github.com/thinkwork-ai/thinkwork/pull/1280) | Merged | `pnpm install`; `pnpm schema:build`; GraphQL codegen for CLI/mobile/admin; `pnpm --filter @thinkwork/api test -- src/lib/slack/user-link-store.test.ts src/graphql/resolvers/slack/slack.resolvers.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/mobile test`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh oauth-authorize`; `bash scripts/build-lambdas.sh oauth-callback`; `git diff --check`; touched-file Prettier check; `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf`; GitHub checks; post-merge Deploy run                                                                                                                              | Implemented Slack per-user OAuth linking through the existing mobile credentials flow, `slack_user_links` GraphQL query/unlink mutation, mobile Slack connect/unlink UI, and Slack app credential wiring for the generic OAuth handlers. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                             |
| 2026-05-16 | U6   | `codex/slack-workspace-u6-events`         | [#1283](https://github.com/thinkwork-ai/thinkwork/pull/1283) | Merged | `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts src/handlers/slack/_shared.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/lambda test`; `bash scripts/build-lambdas.sh slack-events`; `bash scripts/build-lambdas.sh slack-dispatch`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                          | Implemented Slack Events API intake: signed URL verification, app mention / DM handling, Slack identity lookup, Computer task enqueue, placeholder posting, and event dedupe. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-16 | U7   | `codex/slack-workspace-u7-slash-command`  | [#1285](https://github.com/thinkwork-ai/thinkwork/pull/1285) | Merged | `pnpm --filter @thinkwork/api test -- src/handlers/slack/slash-command.test.ts src/handlers/slack/events.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-slash-command`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                  | Implemented `/thinkwork` slash command handler, response_url envelope wiring, shared linked-Computer routing, and ephemeral attribution blocks. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-05-16 | U8   | `codex/slack-workspace-u8-interactivity`  | [#1287](https://github.com/thinkwork-ai/thinkwork/pull/1287) | Merged | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/handlers/slack/interactivity.test.ts` (failed before implementation, passed after implementation); `pnpm --filter @thinkwork/api test -- src/handlers/slack/interactivity.test.ts src/lib/slack/envelope.test.ts src/lib/computers/tasks.test.ts`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-interactivity`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                       | Implemented Slack interactivity intake for message actions, ephemeral promotion, App Home connect action, modal metadata, and file-aware message-action envelopes. Local Compound-style review added a guard so failed public promotions do not delete the original ephemeral response. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                              |
| 2026-05-16 | U9   | `codex/slack-workspace-u9-envelope`       | [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) | Merged | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/lib/slack/envelope.test.ts src/lib/slack/thread-mapping.test.ts src/lib/computers/tasks.test.ts src/handlers/slack/events.test.ts src/handlers/slack/slash-command.test.ts src/handlers/slack/interactivity.test.ts`; `uv run pytest packages/agentcore-strands/agent-container/test_invoker_env.py`; `uv run ruff check packages/agentcore-strands/agent-container/container-sources/invocation_env.py packages/agentcore-strands/agent-container/test_invoker_env.py`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/api test`; Slack Lambda builds; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run | Implemented the canonical Slack task envelope, centralized Slack-to-ThinkWork thread/message mapping, handler mapping integration, stricter Computer task normalization, and Python runtime environment passthrough for Slack metadata. Branch required a clean rebase onto `origin/main` before merge; focused tests/typecheck passed after the rebase. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                             |
| 2026-05-16 | U10  | `codex/slack-workspace-u10-dispatch`      | [#1290](https://github.com/thinkwork-ai/thinkwork/pull/1290) | Merged | `pnpm install`; `pnpm --filter @thinkwork/lambda test -- __tests__/slack-dispatch.test.ts`; `pnpm --filter @thinkwork/api test -- src/handlers/computer-runtime.test.ts src/lib/computers/runtime-api.test.ts`; `uv run pytest packages/agentcore-strands/agent-container/test_computer_thread_response.py packages/agentcore-strands/agent-container/test_slack_post_back.py`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/api typecheck`; `pnpm -r --if-present typecheck`; `pnpm --filter @thinkwork/lambda test`; `pnpm --filter @thinkwork/api test`; `bash scripts/build-lambdas.sh slack-dispatch`; Terraform fmt/validate; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run            | Implemented the platform-owned Slack post-back runtime wrapper, Slack completion dispatcher, attribution fallback, and scheduled drain wiring. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-17 | U11  | `codex/slack-workspace-u11-tests-metrics` | [#1292](https://github.com/thinkwork-ai/thinkwork/pull/1292) | Merged | `pnpm install`; `pnpm --filter @thinkwork/api test -- src/handlers/slack/_shared.test.ts src/handlers/slack/events.test.ts src/handlers/slack/slash-command.test.ts src/handlers/slack/interactivity.test.ts test/integration/slack-acceptance.test.ts`; `pnpm --filter @thinkwork/lambda test -- __tests__/slack-dispatch.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/lambda typecheck`; `pnpm --filter @thinkwork/api test`; `pnpm --filter @thinkwork/lambda test`; `pnpm -r --if-present typecheck`; `bash scripts/build-lambdas.sh slack-dispatch`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                               | Added Slack EMF metric helpers, Slack ingress/dispatch metric wiring, AE1-AE6 acceptance-example coverage, and dispatch/degradation metric assertions. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                                                                                               |
| 2026-05-17 | U12  | `codex/slack-workspace-u12-docs`          | [#1294](https://github.com/thinkwork-ai/thinkwork/pull/1294) | Merged | `pnpm install`; `pnpm --filter @thinkwork/docs build`; `pnpm --filter @thinkwork/workspace-defaults test`; `pnpm --filter @thinkwork/workspace-defaults typecheck`; `git diff --check`; touched-file Prettier check; GitHub checks; post-merge Deploy run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Added the Slack Workspace App integration guide, Slack data-handling compliance page, Slack dispatch runbook, handler README refresh, and workspace-default guidance that marks Slack as a first-class Computer surface. Squash merged after CI passed; deleted the branch/worktree; post-merge Deploy passed.                                                                                                                                                                                                                                                                                             |

### CI / Merge Log

- Opened [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273).
- First CI run: `cla`, `lint`, `typecheck`, and `verify` passed; `Migration Drift Precheck (dev)` failed because the new hand-rolled migration objects were missing in dev.
- Applied `packages/database-pg/drizzle/0094_slack_workspace_app.sql` to dev and verified the scoped drift reporter returned all markers present; reran the failed precheck.
- Rerun checks on [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273) passed (`cla`, `lint`, `Migration Drift Precheck (dev)`, `verify`, `test`, `typecheck`).
- Squash merged [#1273](https://github.com/thinkwork-ai/thinkwork/pull/1273) into `main` as `505bdebc1e4c7fc21a93098137323761f8b5a1a0`; deleted the local worktree/branch and confirmed the remote branch was gone.
- Watched the post-merge Deploy run for `main`; it passed.
- Opened [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) for U2.
- GitHub required checks for [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) passed after a clean rebase onto `origin/main`.
- Squash merged [#1275](https://github.com/thinkwork-ai/thinkwork/pull/1275) into `main` as `61e0feb7029e9eeb89c1bdbc19931b2b3779293d`; deleted the local worktree/branch and confirmed the remote branch was gone.
- Watched the post-merge Deploy run for `main`; it passed.
- Opened [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) for U3.
- GitHub required checks for [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) passed.
- Squash merged [#1277](https://github.com/thinkwork-ai/thinkwork/pull/1277) into `main` as `3dc6d8cdd7f673f36377661074aae44e05f3ac63`; deleted the local worktree/branch and confirmed the remote branch was gone.
- Watched the post-merge Deploy run for `main`; it passed.
- Started U4 in `.Codex/worktrees/slack-workspace-u4-oauth-admin` on branch `codex/slack-workspace-u4-oauth-admin`.
- Completed local U4 verification, including API focused/full tests, workspace typecheck, admin build/test, Slack OAuth Lambda build, touched-file formatting, and Chrome visual inspection.
- Opened [#1279](https://github.com/thinkwork-ai/thinkwork/pull/1279) for U4.
- Rebased [#1279](https://github.com/thinkwork-ai/thinkwork/pull/1279) onto `origin/main`, reran required checks, and squash merged it as `df40d1d4d84f518a08bc8a2fe01c483c8704f757`.
- Deleted U4 remote/local branch and worktree; watched post-merge Deploy run `25973083180`, which passed.
- Started U5 in `.Codex/worktrees/slack-workspace-u5-user-linking` on branch `codex/slack-workspace-u5-user-linking`.
- Opened [#1280](https://github.com/thinkwork-ai/thinkwork/pull/1280) for U5.
- Required checks for [#1280](https://github.com/thinkwork-ai/thinkwork/pull/1280) passed; squash merged it as `f308cf6bfcfd70da43af850d8b4378354edfd4db`.
- Watched post-merge Deploy run `25973695133`, which passed; deleted U5 remote/local branch and worktree.
- Started U6 in `.Codex/worktrees/slack-workspace-u6-events` on branch `codex/slack-workspace-u6-events`.
- Completed U6 local verification and prepared the branch for PR.
- Opened [#1283](https://github.com/thinkwork-ai/thinkwork/pull/1283) for U6.
- Required checks for [#1283](https://github.com/thinkwork-ai/thinkwork/pull/1283) passed; squash merged it as `8f4d1ab3d58c7843ee329f889950703d441b45ce`.
- Watched post-merge Deploy run `25974260815`, which passed; deleted U6 remote/local branch and worktree.
- Started U7 in `.Codex/worktrees/slack-workspace-u7-slash-command` on branch `codex/slack-workspace-u7-slash-command`.
- Completed U7 local verification and prepared the branch for PR.
- Opened [#1285](https://github.com/thinkwork-ai/thinkwork/pull/1285) for U7.
- Required checks for [#1285](https://github.com/thinkwork-ai/thinkwork/pull/1285) passed; squash merged it as `9612c3173af6d991fe7ae63c727523cd87e1514c`.
- Watched post-merge Deploy run `25974693969`, which passed; deleted U7 remote/local branch and worktree.
- Started U8 in `.Codex/worktrees/slack-workspace-u8-interactivity` on branch `codex/slack-workspace-u8-interactivity`.
- Completed U8 local implementation and verification; preparing the branch for PR.
- Opened [#1287](https://github.com/thinkwork-ai/thinkwork/pull/1287) for U8.
- Required checks for [#1287](https://github.com/thinkwork-ai/thinkwork/pull/1287) passed; squash merged it as `3128ae12999ac70d6c00e42ab142981a04f02969`.
- Watched post-merge Deploy run `25975222668`, which passed; deleted U8 remote/local branch and worktree.
- Started U9 in `.Codex/worktrees/slack-workspace-u9-envelope` on branch `codex/slack-workspace-u9-envelope`.
- Completed U9 local implementation and verification; preparing the branch for PR.
- Opened [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) for U9.
- Required checks for [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) passed; merge initially required rebasing onto `origin/main`.
- Rebased U9, reran focused API/Python checks, pushed with `--force-with-lease`, and required checks passed again.
- Squash merged [#1289](https://github.com/thinkwork-ai/thinkwork/pull/1289) as `09383bec5306130ce6701be85a3446dac84bcaca`; merge command reported the known local `main` worktree bookkeeping error, but GitHub confirmed the PR was merged.
- Watched post-merge Deploy run `25975833265`, which passed; deleted U9 remote/local branch and worktree.
- Started U10 in `.Codex/worktrees/slack-workspace-u10-dispatch` on branch `codex/slack-workspace-u10-dispatch`.
- Completed U10 local implementation and verification; preparing the branch for PR.
- Opened [#1290](https://github.com/thinkwork-ai/thinkwork/pull/1290) for U10.
- Required checks for [#1290](https://github.com/thinkwork-ai/thinkwork/pull/1290) passed; squash merged it as `af8698793d856a719f7fe9aa632bf948b1ba045f`.
- Watched post-merge Deploy run `25976357907`, which passed; deleted U10 remote/local branch and worktree.
- Started U11 in `.Codex/worktrees/slack-workspace-u11-tests-metrics` on branch `codex/slack-workspace-u11-tests-metrics`.
- Added Slack EMF metric helpers and acceptance-example integration coverage; local focused/full package tests, repo typecheck, Slack dispatch Lambda build, whitespace check, and touched-file formatting check passed.
- Opened [#1292](https://github.com/thinkwork-ai/thinkwork/pull/1292) for U11.
- Required checks for [#1292](https://github.com/thinkwork-ai/thinkwork/pull/1292) passed; squash merged it as `85a0f6bbcb07062fa584512c3281ca5acee0aa70`.
- Watched post-merge Deploy run `25976879391`, which passed; deleted U11 remote/local branch and worktree.
- Started U12 in `.Codex/worktrees/slack-workspace-u12-docs` on branch `codex/slack-workspace-u12-docs`.
- Completed U12 documentation updates and local verification; preparing the branch for PR.
- Opened [#1294](https://github.com/thinkwork-ai/thinkwork/pull/1294) for U12.
- Required checks for [#1294](https://github.com/thinkwork-ai/thinkwork/pull/1294) passed; squash merged it as `0afb7dfd24572e3ef4ef5ce6db6f7a4effd76030`.
- Watched post-merge Deploy run `25977319292`, which passed; deleted U12 remote/local branch and worktree.
- All implementation units from `docs/plans/2026-05-16-004-feat-thinkwork-computer-slack-workspace-app-plan.md` are complete and merged.

### Live Slack Setup / E2E Verification

- Created the dev Slack app `ThinkWork Dev` in the Homecare Intelligence Slack workspace.
- Populated the `thinkwork/dev/slack/app` Secrets Manager secret with Slack app credentials and verified the secret shape without exposing the secret values.
- Verified signed Slack Events URL challenge smoke against the deployed `/slack/events` route returned `200` and echoed the challenge.
- Verified unsigned Slack Events API requests are rejected with `401`.
- Confirmed deployed docs/admin routes are live:
  - `https://docs.thinkwork.ai/integrations/slack/`
  - `https://docs.thinkwork.ai/operations/slack-dispatch-runbook/`
  - `https://admin.thinkwork.ai/slack`
- Found live admin install failure after U12: `startSlackWorkspaceInstall` returned a GraphQL error because `graphql-http` lacked access to Slack app credentials.
- Opened and merged [#1298](https://github.com/thinkwork-ai/thinkwork/pull/1298) (`fix(slack): wire app credentials into GraphQL`), but its post-merge deploy failed during Terraform apply because the added Lambda environment variable pushed `graphql-http` past AWS's 4KB environment limit.
- Opened and merged [#1300](https://github.com/thinkwork-ai/thinkwork/pull/1300) (`fix(slack): load app credentials without GraphQL env`) to use the stage-scoped secret fallback from `graphql-http` instead of wiring another environment variable. Required checks passed and Deploy run `25979254054` passed.
- Verified deployed `thinkwork-dev-api-graphql-http` was updated at `2026-05-17T02:37:31Z`, is on `STAGE=dev`, and does not include `SLACK_APP_CREDENTIALS_SECRET_ARN`.
- Started Slack workspace install through the deployed `startSlackWorkspaceInstall` GraphQL mutation using the live admin owner session, completed Slack OAuth approval in Brave, and verified the redirect returned `slackInstall=success`.
- Verified `slack_workspaces` contains one active Homecare Intelligence workspace row:
  - `slack_team_id`: `T1U9X1BEH`
  - `app_id`: `A0B443U357D`
  - `bot_user_id`: `U0B54RVL9NU`
  - `status`: `active`
- Ran the deployed per-user Slack OAuth linking flow through `/api/oauth/authorize?provider=slack`, approved Sign in with Slack, and verified the redirect returned `status=connected&provider=slack`.
- Verified `slack_user_links` contains one active link for the ThinkWork user `4dee701a-c17b-46fe-9f38-a333d4c3fad0` and Slack user `U1UA2R8V7`.
- Verified Slack Web API `auth.test` succeeds for the installed bot in Homecare Intelligence.
- Ran a signed Slack Events API DM smoke for the linked user. The deployed `/slack/events` route returned `200` with task `759fd77c-ac07-450f-a4c9-dbad85c52306`; the task completed, created Slack thread mapping `695b782a-7712-4959-8a4c-79768cbabbce`, and wrote a user/assistant exchange to ThinkWork thread `3711ff02-a2a5-482d-9005-9a44f6af5d54`.
- Verified the bot DM channel received a Slack bot message after the event smoke.
- Ran a signed `/thinkwork` slash-command ingress smoke for the linked user. The deployed `/slack/slash-command` route returned `200` and queued task `b976be63-6d84-4381-924a-0217bf36bb39`; the Computer completed the ThinkWork response, but final Slack delivery failed because the smoke used an intentionally fake `response_url`.

### Post-Implementation Live Debug

- Started hotfix branch `codex/debug-slack-threads` in `.Codex/worktrees/debug-slack-threads` after live reports that Slack placeholders were not becoming useful answers and both Admin/Computer Threads pages showed `[GraphQL] Unexpected error`.
- Confirmed GraphQL root cause in CloudWatch: Slack-created threads persisted `channel = 'slack'`, `threadToCamel` returned `SLACK`, but `ThreadChannel` did not include `SLACK`, causing `Enum "ThreadChannel" cannot represent value: "SLACK"` for `threadsPaged.items[0].channel`.
- Confirmed Slack dispatch root cause from dev DB rows: completed Slack tasks stored `output.responseMessageId` with a valid assistant message, but `output.response` was empty, so `slack-dispatch` sent the fallback `"ThinkWork response"` instead of the message content.
- Implemented hotfix to add `SLACK` to the GraphQL enum, regenerate generated GraphQL clients, and have `slack-dispatch` resolve assistant message content from `responseMessageId` when inline output text is absent.
- Local verification passed:
  - `pnpm install --frozen-lockfile`
  - `pnpm schema:build`
  - GraphQL codegen for `apps/admin`, `apps/mobile`, and `apps/cli`
  - `pnpm --filter @thinkwork/lambda test -- slack-dispatch.test.ts`
  - `pnpm --filter @thinkwork/api test -- src/__tests__/graphql-contract.test.ts src/__tests__/thread-resolver.test.ts`
  - `pnpm --filter @thinkwork/lambda typecheck`
  - `pnpm --filter @thinkwork/api typecheck`
- Opened and merged [#1312](https://github.com/thinkwork-ai/thinkwork/pull/1312) (`fix(slack): surface thread channels and response text`). Required checks passed and Deploy run `25987731904` passed.
- Verified deployed `threadsPaged` now returns Slack threads with `channel: SLACK`; Admin and Computer Threads pages can load Slack-created threads again.
- Ran a signed Slack Events API DM smoke. The task completed with assistant message `Got it. Marco here and operational.`, but the scheduled Slack dispatch Lambda continued timing out before marking `slack.dispatch_completed`.
- Started follow-up hotfix branch `codex/fix-slack-dispatch-drain` in `.Codex/worktrees/debug-slack-threads`.
- Confirmed Slack dispatch timeout root cause: `loadPending` scanned from `computer_events` task-completion rows, then filtered for Slack tasks and dispatch markers. In dev this exceeded the 30s Lambda timeout before the pending Slack completion could be posted.
- Implemented follow-up hotfix to load pending Slack completions from completed `computer_tasks` first, resolve the source completion event with a per-task subquery, and keep assistant-message lookup tenant-scoped.
- Incorporated live UX feedback: Slack event ingestion no longer posts a visible `Marco is thinking...` placeholder for app mentions/DMs. Final answers post as the only bot reply when dispatch completes; existing legacy placeholders can still be updated if already present on older tasks.
- Local verification for the follow-up hotfix passed:
  - `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts test/integration/slack-acceptance.test.ts`
  - `pnpm --filter @thinkwork/lambda test -- slack-dispatch.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/lambda typecheck`
  - `bash scripts/build-lambdas.sh slack-events`
  - `bash scripts/build-lambdas.sh slack-dispatch`
  - `git diff --check`
- Opened and merged [#1313](https://github.com/thinkwork-ai/thinkwork/pull/1313) (`fix(slack): drain completed tasks and remove placeholders`). Required checks passed and Deploy run `25988195062` passed.
- Verified deployed Lambda timestamps after the deploy:
  - `thinkwork-dev-api-slack-events`: `2026-05-17T10:25:18Z`
  - `thinkwork-dev-api-slack-dispatch`: `2026-05-17T10:25:11Z`
- Ran a signed Slack Events API DM smoke after deploy. The deployed route returned task `2805de2c-eb9b-4705-8f1a-5136f9dbab1c`; the Computer completed it and `slack-dispatch` posted `slack final response ok` to Slack at `1779013812.283429`.
- Verified the previously stuck task `4bb289b6-acfb-422c-ab49-178081308ecd` also now has `slack.dispatch_completed` with Slack timestamp `1779012410.992669`.
- Started follow-up UX hotfix branch `codex/slack-branding-placeholders` in `.Codex/worktrees/slack-branding-placeholders` after live feedback that Slack needs a pending response and should consistently display as `ThinkWork` with the brain logo rather than `Eric Odom's Computer`.
- Implemented branded pending placeholders for Slack Events API DM/app-mention tasks. New Slack tasks post `Marco is thinking...` as `ThinkWork`, persist the placeholder timestamp, and replace that same message with the final response.
- Standardized outbound Slack dispatcher messages to use `ThinkWork` plus `https://admin.thinkwork.ai/logo.png` for `chat.postMessage`/`chat.update`, while preserving the per-Computer routing attribution in the message footer.
- Local verification for the branding/placeholder hotfix passed:
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts test/integration/slack-acceptance.test.ts`
  - `pnpm --filter @thinkwork/lambda test -- slack-dispatch.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/lambda typecheck`
  - `bash scripts/build-lambdas.sh slack-events`
  - `bash scripts/build-lambdas.sh slack-dispatch`
  - `git diff --check`
- Opened and merged [#1316](https://github.com/thinkwork-ai/thinkwork/pull/1316) (`fix(slack): brand responses and update placeholders`). Required checks passed, then the branch was rebased because it was behind `main`; checks passed again after the rebase and Deploy run `25989295990` passed.
- Verified deployed Lambda timestamps after the deploy:
  - `thinkwork-dev-api-slack-events`: `2026-05-17T11:18:27Z`
  - `thinkwork-dev-api-slack-dispatch`: `2026-05-17T11:18:21Z`
- Ran a signed Slack Events API DM smoke after deploy. The deployed route returned task `8eaa1373-8764-4159-9fd7-cde9c48df0ad`; the task completed with placeholder timestamp `1779017099.807819`, stored the same timestamp in `input.slack.placeholderTs`, and `slack-dispatch` completed with `mode: chat_update`.
- Verified Slack API history for the smoke message shows the final visible message at timestamp `1779017099.807819` with `username: ThinkWork`, text `branded placeholder ok`, and a Slack-cached bot icon derived from the configured ThinkWork logo.
- Started follow-up visual hotfix branch `codex/slack-dark-icon` in `.Codex/worktrees/slack-dark-icon` after live feedback that the Slack icon was showing the transparent logo against a white tile in dark-mode Slack.
- Added `apps/admin/public/slack-icon.png`, a 512x512 opaque dark square generated by the admin brand asset script, and changed Slack event placeholders plus Slack dispatch defaults to use `https://admin.thinkwork.ai/slack-icon.png`.
- Local verification for the dark Slack icon hotfix passed:
  - `pnpm install --frozen-lockfile`
  - `node apps/admin/scripts/generate-brand-assets.mjs`
  - `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts test/integration/slack-acceptance.test.ts`
  - `pnpm --filter @thinkwork/lambda test -- slack-dispatch.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/lambda typecheck`
  - `bash scripts/build-lambdas.sh slack-events`
  - `bash scripts/build-lambdas.sh slack-dispatch`
  - `pnpm --filter @thinkwork/admin build`
  - `git diff --check`

### Blockers

- None.

---

# Prior Run: Retire OSS Symphony And Connectors

## Current State

- Target branch: `main`
- Active unit: none - plan implementation complete
- Active branch: none
- Active worktree: none
- Started: 2026-05-14
- Completed: 2026-05-14

## Progress Log

### 2026-05-14

- Read `AGENTS.md`.
- Read `docs/plans/2026-05-14-001-refactor-retire-oss-symphony-connectors-plan.md`.
- Read migration-related prior learnings:
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
  - `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`
- Created isolated worktree from `origin/main` for U1.
- Confirmed `origin/main` already has `0086_update_default_template_models.sql`; U1 will use `0087_retire_oss_connectors.sql`.
- Implemented the grouped U1-U6 cleanup:
  - Removed the OSS connector/Symphony GraphQL contract, generated clients, admin/computer UI routes, CLI command, runtime/poller code, Terraform poller resources, and public docs.
  - Removed connector database schema exports and obsolete connector migrations from the OSS tree.
  - Added `0087_retire_oss_connectors.sql` to drop installed connector tables and tracker-specific external refs during upgrade.
  - Replaced connector-focused docs with narrower integration/MCP language that does not expose Symphony as an OSS feature.
- Verified repo search no longer finds active Symphony/connector runtime identifiers outside the retirement migration and tests.
- Opened [#1226](https://github.com/thinkwork-ai/thinkwork/pull/1226), waited for required checks, and squash-merged it to `main`.
- Deleted the remote branch `codex/retire-oss-connectors-u1`.

## Pull Requests

| Unit  | Branch                           | PR                                                           | Status | Notes                                                                                                                                                                               |
| ----- | -------------------------------- | ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1-U7 | `codex/retire-oss-connectors-u1` | [#1226](https://github.com/thinkwork-ai/thinkwork/pull/1226) | Merged | Grouped because deleting the database connector schema breaks API, admin, computer, generated clients, and rollout verification until the connector contract is removed everywhere. |

## CI / Verification Log

- `pnpm install` - passed.
- `pnpm schema:build` - passed.
- `pnpm --filter @thinkwork/admin codegen` - passed.
- `pnpm --filter @thinkwork/mobile codegen` - passed.
- `pnpm --filter thinkwork-cli codegen` - passed.
- `pnpm --filter @thinkwork/admin build` - passed.
- `pnpm --filter @thinkwork/computer typecheck` - passed.
- `pnpm --filter @thinkwork/computer build` - passed.
- Targeted database/API/computer/computer-runtime tests for removed connector behavior - passed.
- `pnpm --filter thinkwork-cli test` - passed.
- `pnpm --filter @thinkwork/docs build` - passed.
- `pnpm --filter @thinkwork/admin test` - passed.
- `pnpm -r --if-present typecheck` - passed.
- `pnpm -r --if-present test` - passed.
- `git diff --check` - passed.
- `pnpm format:check` - blocked locally because `prettier` is not installed in this workspace (`sh: prettier: command not found`).
- GitHub PR checks on [#1226](https://github.com/thinkwork-ai/thinkwork/pull/1226) - passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`

## Blockers

None.

# Requester Memory Dreaming - 2026-05-18

## Status

- Merged [#1404](https://github.com/thinkwork-ai/thinkwork/pull/1404) as `5f73e60e16efda91c655493dc859c5bf1be88d8e`.
- Merged [#1405](https://github.com/thinkwork-ai/thinkwork/pull/1405) as `d700680e970e0fb2fc2927ab1a520e0aae529494`.
- Deploy run `26056853159` failed during Terraform Apply because adding requester memory feature flags to every API Lambda pushed `graphql-http` over AWS Lambda's 4 KB environment-variable limit.
- Deploy run `26057554393` failed during Terraform Apply because the remaining `REQUESTER_IDLE_MEMORY_LEARNING_ENABLED` key on `graphql-http` was still enough to exceed the same limit.
- Current hotfix branch: `codex/requester-memory-env-compact`.
- Current fix: idle-learning scheduling now defaults on unless explicitly disabled, and `graphql-http` no longer carries the requester idle-learning env var.

# Requester Memory Dreaming - 2026-05-18

## Status

- Branch: `codex/requester-memory-dreaming`
- Started: `2026-05-18T19:18:00Z`
- Plan: `docs/plans/2026-05-18-002-feat-requester-memory-dreaming-plan.md`
- Implemented locally:
  - Added requester memory dreaming storage/source listing with public dream reports and hidden `.dreams` state.
  - Added broad user-level dreaming sweep with light, REM, deep, and deterministic compaction/promotion phases.
  - Added LLM REM reflection through Bedrock Converse with deterministic fallback.
  - Added `requester-memory-dreaming` Lambda handler, build artifact wiring, Terraform feature flags, and nightly EventBridge Scheduler rule.
  - Enabled dev greenfield defaults for requester idle learning and requester memory dreaming.
  - Updated User context listing so admins can see `memory/DREAMS.md` and `memory/dreaming/...` while hidden internal/report files stay filtered.

## Verification Log

- `pnpm install` - passed, required because the new worktree had no `node_modules`.
- `pnpm --filter @thinkwork/api test -- src/lib/requester-memory/dreaming.test.ts src/handlers/requester-memory-dreaming.test.ts src/lib/requester-memory/storage.test.ts src/__tests__/workspace-files-handler.test.ts` - passed, 80 tests.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `pnpm --filter @thinkwork/api lint` - skipped because `@thinkwork/api` has no `lint` script.
- `pnpm --filter @thinkwork/api test` - passed, 2,945 tests and 16 skipped across 320 files.
- `bash scripts/build-lambdas.sh requester-memory-dreaming && bash scripts/build-lambdas.sh thread-idle-memory-learning` - passed.
- `pnpm dlx prettier@3.8.2 --write ...` - passed for touched TypeScript files. Root `pnpm exec prettier` is unavailable in this worktree because the workspace does not expose a local prettier binary.
- `terraform fmt ...` - passed.
- `terraform -chdir=terraform/examples/greenfield init -backend=false` - passed.
- `terraform -chdir=terraform/examples/greenfield validate` - passed.
- `agent-browser open http://localhost:5174/knowledge/user && agent-browser snapshot -i` - passed; unauthenticated browser redirected to `/sign-in?next=%2Fknowledge%2Fuser` as expected.
- `pnpm --filter @thinkwork/admin typecheck` - skipped because `@thinkwork/admin` has no `typecheck` script.
- `pnpm --filter @thinkwork/admin build` - passed.
- `git diff --check` - passed.

## CI / PR

- Opened [#1404](https://github.com/thinkwork-ai/thinkwork/pull/1404).
- GitHub PR checks on [#1404](https://github.com/thinkwork-ai/thinkwork/pull/1404) passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`
- Squash merged [#1404](https://github.com/thinkwork-ai/thinkwork/pull/1404) as `5f73e60e16efda91c655493dc859c5bf1be88d8e`.
- Deploy run `26056853159` failed in Terraform Apply because adding requester memory environment variables to the shared Lambda `common_env` pushed `graphql-http` over AWS Lambda's 4 KB environment-variable limit.
- Hotfix branch: `codex/requester-memory-env-hotfix`.

## Blockers

None.

---

# Slack File Attachment Hotfix - 2026-05-17

## Status

- Branch: `codex/slack-file-attachments`
- Started: `2026-05-17T12:32:34Z`
- Root cause:
  - Slack file uploads arrive as human `message` events with `subtype: "file_share"`, but `slack-events` ignored all subtyped messages.
  - Slack file refs were preserved in task metadata, but they were never downloaded into ThinkWork `thread_attachments` or linked through `messages.metadata.attachments`, so the Computer runtime had no staged files to read.
- Implemented:
  - Accept human Slack `file_share` DMs and bot-mentioned channel file shares as Slack turns.
  - Download Slack files with the bot token, validate safe attachment types, store them under the existing tenant/thread attachment S3 prefix, insert `thread_attachments`, and link attachment IDs onto the user message metadata before dispatch.
  - Extend attachment validation to safe text documents (`.md`, `.txt`) in addition to the existing Excel/CSV support so Slack document review works for uploaded Markdown files.

## Verification Log

- `pnpm install` - passed.
- Targeted API tests for Slack events, Slack envelope parsing, Slack file materialization, attachment validation, and Slack acceptance examples - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `pnpm --filter @thinkwork/api test` - passed.
- `pnpm --filter @thinkwork/api build` - passed.

## CI / PR

- Opened [#1320](https://github.com/thinkwork-ai/thinkwork/pull/1320).
- GitHub PR checks on [#1320](https://github.com/thinkwork-ai/thinkwork/pull/1320) passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`
- Squash merged [#1320](https://github.com/thinkwork-ai/thinkwork/pull/1320) as `190e2299d1f8086b9364357d4746c5b9df595e5c`; Deploy run `25991215749` passed.
- Live smoke confirmed Slack file-share tasks now enqueue, but follow-up testing exposed a second gap: replies like "Can you review this file?" need to inherit files uploaded earlier in the Slack thread.

# Slack Thread File Context Hotfix - 2026-05-17

## Status

- Branch: `codex/slack-thread-file-context`
- Started: `2026-05-17T13:00:00Z`
- Root cause:
  - Slack `conversations.replies` returns file metadata for earlier messages in the thread, but `slack-events` reduced thread context to `{ user, botId, ts, text }` and discarded `files`.
  - `buildSlackThreadTurnInput` only considered files attached to the exact triggering Slack event, so a reply such as "Can you review this file?" had no `fileRefs` even when the file was visible earlier in the Slack thread.
- Implemented:
  - Preserve parsed Slack file refs on `SlackThreadContextMessage`.
  - Merge current-message file refs with prior Slack thread-context file refs, deduped by Slack file id, before materializing ThinkWork attachments.
  - Keep file-bearing Slack thread-context messages even when long thread text exceeds the summary budget, so attachment metadata is not dropped by summarization.

## Verification Log

- `pnpm install` - passed.
- `pnpm --filter @thinkwork/api exec vitest run src/lib/slack/envelope.test.ts src/handlers/slack/events.test.ts test/integration/slack-acceptance.test.ts` - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `pnpm --filter @thinkwork/api test` - passed.
- `bash scripts/build-lambdas.sh slack-events` - passed.
- `git diff --check` - passed.
- `pnpm exec prettier --check ...` - blocked locally because `prettier` is not installed in this workspace (`Command "prettier" not found`).

## CI / PR

- Opened [#1321](https://github.com/thinkwork-ai/thinkwork/pull/1321).
- GitHub PR checks on [#1321](https://github.com/thinkwork-ai/thinkwork/pull/1321) passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`
- Squash merged [#1321](https://github.com/thinkwork-ai/thinkwork/pull/1321) as `323c94776a18a66e05e8f47778cd3f8186476c68`; Deploy run `25991999562` passed.
- Live smoke still returned `threadContext: []`; CloudWatch showed Slack `conversations.replies` returned `invalid_arguments`.

# Slack Thread Context Fetch Hotfix - 2026-05-17

## Status

- Branch: `codex/slack-replies-form-fetch`
- Started: `2026-05-17T13:30:00Z`
- Root cause:
  - Slack `chat.postMessage` accepts JSON, but `conversations.replies` rejected the JSON request body with `invalid_arguments` and reported missing `channel`/`ts`.
  - The same `conversations.replies` call succeeds when sent as `application/x-www-form-urlencoded`, so the deployed Slack Events Lambda was discarding thread context before the #1321 merge logic could see prior file uploads.
- Implemented:
  - Use a form-encoded Slack Web API helper for `conversations.replies`.
  - Added a regression test that asserts `conversations.replies` is called with form encoding and that earlier thread files are materialized.

## Verification Log

- `pnpm --filter @thinkwork/api exec vitest run src/handlers/slack/events.test.ts src/lib/slack/envelope.test.ts test/integration/slack-acceptance.test.ts` - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `bash scripts/build-lambdas.sh slack-events` - passed.
- `git diff --check` - passed.

## CI / PR

- Opened [#1323](https://github.com/thinkwork-ai/thinkwork/pull/1323).
- GitHub PR checks on [#1323](https://github.com/thinkwork-ai/thinkwork/pull/1323) passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`
- Squash merged [#1323](https://github.com/thinkwork-ai/thinkwork/pull/1323) as `a66362458775395dea07e1ea7479e94a7f30a99e`; Deploy run `25992538831` passed.
- Live smoke confirmed `threadContext` now includes earlier Slack messages and file refs, and the Slack file is materialized as a ThinkWork `thread_attachments` row linked to the current user message. The response still said no file was available because Marco's Computer runs on the `flue` runtime, while attachment staging only existed in the Strands runtime.

# Flue Slack Attachment Runtime Hotfix - 2026-05-17

## Status

- Branch: `codex/slack-attachment-runtime`
- Started: `2026-05-17T14:10:00Z`
- Root cause:
  - Slack files are now correctly mapped into ThinkWork message attachments, but Marco's Computer resolves to agent runtime `flue`.
  - `chat-agent-invoke` forwards `message_attachments` to both runtimes, but only the Strands Python runtime staged those S3 attachments into per-turn local files and exposed a `file_read` affordance.
  - Flue therefore answered from Slack thread text/history alone and could still claim the file was unavailable.
- Implemented:
  - Added Flue per-turn message attachment staging from the existing `message_attachments` payload, with tenant/thread S3-key prefix validation and per-turn `/tmp` cleanup.
  - Added a restricted Flue `file_read` tool that only reads the staged attachment paths for the current turn.
  - Added an attachment prompt block that explicitly lists attached files, includes text previews for text-like files, and tells the model not to claim no file is attached.

## Verification Log

- `pnpm --filter @thinkwork/agentcore-flue test -- agent-container/tests/message-attachments.test.ts agent-container/tests/server.test.ts` - passed.
- `pnpm --filter @thinkwork/agentcore-flue typecheck` - passed.
- `pnpm --filter @thinkwork/api test -- src/handlers/slack/events.test.ts src/lib/slack/envelope.test.ts test/integration/slack-acceptance.test.ts` - passed.
- `pnpm --filter @thinkwork/agentcore-flue test` - passed.
- `pnpm --filter @thinkwork/agentcore-flue build` - passed.
- `git diff --check` - passed.
- `pnpm exec prettier --check ...` - blocked locally because `prettier` is not installed in this workspace (`Command "prettier" not found`).

## CI / PR

- Opened [#1328](https://github.com/thinkwork-ai/thinkwork/pull/1328).
- GitHub PR checks on [#1328](https://github.com/thinkwork-ai/thinkwork/pull/1328) passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`
- Squash merged [#1328](https://github.com/thinkwork-ai/thinkwork/pull/1328) as `c933f433280f012d6788ef5c30717d64c472fe52`; Deploy run `25993640509` passed.
- Live smoke still returned a "no file" response. DB task output showed `mode: computer_native` and no `thread_turn_dispatched` event, proving Slack turns are executing through the Computer-native runtime rather than the Flue AgentCore invoke path.

# Computer-Native Slack Attachment Context Hotfix - 2026-05-17

## Status

- Branch: `codex/computer-runtime-attachment-context`
- Started: `2026-05-17T14:45:00Z`
- Root cause:
  - Slack ingestion now links the file to the ThinkWork user message, but Computer-native `loadThreadTurnContext` only returned message text/history/system prompt.
  - `@thinkwork/computer-runtime` therefore called Bedrock without any attachment metadata or file content and could truthfully answer that no file was visible in its prompt context.
- Implemented:
  - The Computer runtime context API now resolves `messages.metadata.attachments` into tenant-pinned thread attachment records.
  - Text-like attachments are read from S3 through the API and returned inline in the current turn context with size/truncation metadata.
  - The Computer runtime system prompt now includes a current-turn file block and tells the model not to claim no file is attached.

## Verification Log

- `pnpm --filter @thinkwork/api test -- src/lib/computers/runtime-api.test.ts` - passed.
- `pnpm --filter @thinkwork/computer-runtime test -- src/computer-chat.test.ts` - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `pnpm --filter @thinkwork/computer-runtime typecheck` - passed.
- `pnpm --filter @thinkwork/api test -- src/lib/computers/runtime-api.test.ts src/handlers/slack/events.test.ts src/lib/slack/file-attachments.test.ts test/integration/slack-acceptance.test.ts` - passed.
- `pnpm --filter @thinkwork/computer-runtime test` - passed.
- `pnpm --filter @thinkwork/computer-runtime build` - passed.
- `pnpm --filter @thinkwork/api build` - passed.
- `git diff --check` - passed.
- `pnpm exec prettier --check ...` - blocked locally because `prettier` is not installed in this workspace (`Command "prettier" not found`).

## CI / PR

- Opened [#1330](https://github.com/thinkwork-ai/thinkwork/pull/1330).
- Rebased [#1330](https://github.com/thinkwork-ai/thinkwork/pull/1330) after `main` advanced; reran touched unit slices after rebase:
  - `pnpm --filter @thinkwork/api test -- src/lib/computers/runtime-api.test.ts` - passed.
  - `pnpm --filter @thinkwork/computer-runtime test -- src/computer-chat.test.ts` - passed.
- GitHub PR checks on [#1330](https://github.com/thinkwork-ai/thinkwork/pull/1330) passed:
  - `cla`
  - `lint`
  - `test`
  - `typecheck`
  - `verify`
- Squash merged [#1330](https://github.com/thinkwork-ai/thinkwork/pull/1330) as `e0a2c80e68d4cdeddf00793f94135e433a347d1d`.
- Deploy run `25994235900` initially failed in `Build & Deploy Computer` during `terraform init` because the Terraform registry/GitHub returned a transient `502 Bad Gateway` while fetching the Cloudflare provider signature. No code change was made; rerunning failed jobs passed.
- Deploy run `25994235900` passed on rerun, including `Build Computer Runtime` and `Build & Deploy Computer`.
- Live Slack smoke after deploy:
  - Signed Slack event `EvCodexComputerFile1779031002` enqueued task `71a58579-b480-4d45-a83b-637e736f6992`.
  - Task completed in `computer_native` mode with response message `23759467-505c-4fb1-ad5d-ab4278b4efc0`.
  - The user message metadata linked attachment `a229a33d-6722-47f0-be7a-7dd726055400`.
  - The assistant response summarized `agentic-etl-architecture-v5.md` content instead of claiming no file was available.

## Blockers

None.
