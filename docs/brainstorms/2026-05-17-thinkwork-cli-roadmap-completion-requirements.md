---
date: 2026-05-17
topic: thinkwork-cli-roadmap-completion
---

# ThinkWork CLI — Roadmap Completion

## Problem Frame

`apps/cli` (published as `thinkwork-cli` on npm, currently v0.9.2) ships **45 top-level commands** but only **20 are implemented**. The other **25 are scaffolded stubs**: they print real `--help`, parse arguments, then call `notYetImplemented(<path>, <phase>)` and `process.exit(2)`. The user-facing message points readers to `apps/cli/README.md#roadmap`. In total ~170 sub-actions across the stubbed surface are inert.

The Phase 1–5 roadmap was sketched when the CLI was the planned primary management surface. Since then the **admin SPA** absorbed most tenant management UX, **mobile** owns end-user self-serve (per `feedback_user_opt_in_over_admin_config`), and **Computer** became the primary user-facing product. Despite that, the CLI is still the only surface for several power-user workflows — scripting, CI/CD, bulk operations, and "I'd rather stay in the terminal" daily-driver use.

Two friction points on the **already-shipped** surface surfaced during this brainstorm:

- **`thinkwork login` verb is overloaded.** With no `--stage` flag, it runs the deploy-side login (AWS profile picker for terraform/aws shellouts). With `--stage <s>`, it runs the API-side login (Cognito OAuth + tenant resolution). The two flows share one verb with no scent trail between them — a user who completes deploy-login and then runs `thinkwork eval` gets an unfriendly tenant-resolve error and no guidance back to `thinkwork login --stage <s>`.
- **Tenant-unresolved error buries the actual fix.** The current message — *"Pass `--tenant <slug>`, set `THINKWORK_TENANT`, or run `thinkwork login --stage dev`."* — puts the path 90% of users actually need as comma-separated option 3, after two flag suggestions almost no one would prefer.

This brainstorm captures the decision to **finish the original Phase 1–5 roadmap**, anchored on a **power-user terminal** charter (operators + end-users both), shipped **phase-by-phase in original order** with continuous polish of the implemented surface and continuous docs/help sync along the way.

## Charter Decisions

- **Charter — Power-user terminal for two audiences.** The CLI serves both operators/admins (deploy + tenant ops + CI/CD + bulk mutations) and end-users who prefer the terminal for chat/inbox/memory/threads. Mobile and admin SPA continue to exist; the CLI is another front door, not the only one.
- **Sequencing — Phase 1 → 5 in original order.** Implementation order follows `apps/cli/README.md#roadmap` as currently written. UX/docs/help fixes are continuous polish, not a separate stream.
- **Audit posture — light.** Given the power-user-terminal charter, near-all 25 stubs survive. Pruning happens only where a command's original premise is now factually obsolete (e.g. `routine` was scaffolded around the System Workflows / Activation model that was reverted on 2026-05-06; reshape during Phase 3 rather than implement-as-scaffolded).

## Requirements

**Implementation surface — all 25 stubs**

- **R1.** Every command currently calling `notYetImplemented` returns a real result (or a real, command-specific error) instead of exit code 2. The `apps/cli/src/lib/stub.ts` helper is deleted once the last stub is gone.
- **R2.** Phase ordering follows the README roadmap as currently written: Phase 1 (`thread`, `message`, `label`, `inbox`) → Phase 2 (`agent`, `template`, `tenant`, `member`, `team`, `kb`) → Phase 3 (`routine`, `scheduled-job`, `turn`, `wakeup`, `webhook`, `connector`, `skill`) → Phase 4 (`memory`, `recipe`, `artifact`) → Phase 5 (`cost`, `budget`, `performance`, `trace`, `dashboard`).
- **R3.** Each command preserves its currently-scaffolded subcommand shape, options, and `--help` examples unless an explicit reshape decision is recorded during planning (e.g. R-Q1 on `routine`). Surface stability matters because the help text the stubs print is already what users have been reading.
- **R4.** All API-side commands honor the existing global flag conventions: `-s/--stage`, `-t/--tenant`, `-y/--yes`, `--json`, `-r/--region` where present. No new global flags are introduced.
- **R5.** All commands that mutate tenant state respect the existing confirmation/`--yes` pattern used by the implemented surface (e.g. `eval delete`).

**Existing-surface polish**

- **R6.** `thinkwork login` (deploy-side, no `--stage`) finishes its success output with a one-line hint at the API-side login the user almost certainly needs next — wording to be settled in planning but in the shape of *"Next: run `thinkwork login --stage <s>` to start an API session for that stage."*
- **R7.** The tenant-unresolved error (currently emitted from `apps/cli/src/lib/` API-client paths) is rewritten to lead with `thinkwork login --stage <s>` as the obvious primary remediation, with the `--tenant` flag and `THINKWORK_TENANT` env var demoted to a secondary "advanced" line.
- **R8.** Every implemented command's `--help` accurately describes the command's current behavior. Drift between scaffolded `--help` text and shipped behavior is fixed in the PR that implements the command, not deferred.

**Documentation parity — three sources, one truth**

- **R9.** `apps/cli/README.md`, `docs/src/content/docs/applications/cli/commands.mdx`, and per-command `--help` text all describe the same behavior for every shipped command on every release. The README's roadmap section shrinks as commands move from stub to shipped.
- **R10.** Each implementation PR updates README + commands.mdx + `--help` in the same commit as the code change. A PR that adds a real implementation but leaves docs claiming "Phase 4 placeholder" does not merge.
- **R11.** A short "Authentication" section is added to both README and commands.mdx explaining the two login modes (deploy vs API) and the recommended pattern for daily/scripted use (`thinkwork user api-key create` + `$THINKWORK_API_KEY`) vs first-time setup (OAuth).

**Stub-removal mechanics**

- **R12.** As each stub command moves to real, its file in `apps/cli/src/commands/<name>.ts` stops importing `notYetImplemented` and replaces every `.action(() => notYetImplemented(...))` with a real action handler. The phase-comment header (e.g. *"Scaffolded in Phase 0; ships in Phase 4."*) is removed.
- **R13.** The roadmap section of `apps/cli/README.md` is the authoritative source of "what's a stub today" for users who hit one. Once a command is real, its README line in the roadmap section is removed and its entry in the command-list section is updated.

## Open Questions (resolve during planning, not now)

- **R-Q1 (`routine`).** Scaffolded for the System Workflows / Activation model that was reverted on 2026-05-06 (`project_system_workflows_revert_compliance_reframe`). Does `routine` get reshaped (e.g. as a thin wrapper over Compliance audit events), retired outright, or kept as currently scaffolded?
- **R-Q2 (`turn` / `wakeup`).** These can read as low-level operator-debug commands or as genuine end-user surfaces. The power-user-terminal charter accommodates both, but the implementation shape differs (debug = JSON dumps; end-user = readable summaries). Pick before implementing.
- **R-Q3 (`scheduled-job` vs `routine`).** Both touch background work. Confirm their division of labor before Phase 3 starts — likely `scheduled-job` is the operator-facing wrapper over `scheduled_jobs` rows + AWS Scheduler (per `project_automations_eb_provisioning`), but the line vs `routine` needs to be settled.
- **R-Q4 (`dashboard` / `trace` / `performance`).** These were originally scoped as observability commands. Confirm whether they're CLI-rendered tables, deep-links to CloudWatch / AgentCore consoles, or some hybrid before implementing.
- **R-Q5 (`memory` scope).** `memory` predates the agent→user memory refactor (`project_memory_scope_refactor`). Confirm whether CLI `memory` reads from user-level S3 paths, per-agent paths, or both.
- **R-Q6 (auth-token UX details).** `thinkwork user api-key create` is implemented. The recommendation to use `$THINKWORK_API_KEY` for scripting needs a planning-level decision on header name, env-var name precedence vs session cache, and whether any commands intentionally refuse API-key auth (e.g. anything that needs a specific user's OAuth tokens to call a downstream service).

## Success Criteria

- All 25 placeholder commands return real results instead of `notYetImplemented` exit-2. The `notYetImplemented` helper and its `apps/cli/src/lib/stub.ts` file are deleted.
- `thinkwork eval run` (or any other API-side command) works on first try after `thinkwork login --stage <s>`, with no separate AWS-profile-login confusion.
- A user who hits the tenant-unresolved error reads the first line and knows what to do without scanning a comma list.
- `apps/cli/README.md`, `docs/src/content/docs/applications/cli/commands.mdx`, and per-command `--help` for every shipped command describe the same behavior. No section of any of the three claims "placeholder" or "Phase N" for a shipped command, and no shipped command is undocumented.
- A power user can run the full terminal-resident daily flow — `thinkwork inbox`, `thinkwork thread reply <id> "…"`, `thinkwork memory show`, `thinkwork agent list`, `thinkwork eval run --category <name>` — without bouncing to admin or mobile.

## Scope Boundaries

**In scope**

- All 25 stub commands listed in R2.
- The two existing-surface fixes (R6, R7).
- Docs + help-system sync (R9, R10, R11).
- Stub-removal mechanics (R12, R13).

**Deferred / out of scope**

- Reframing the CLI charter — settled: power-user terminal for operators + end-users.
- Net-new commands beyond the 25 currently scaffolded. New verbs can be proposed in a follow-on brainstorm.
- Admin SPA, mobile, or Computer UX changes. Cross-surface UX consistency is desirable but not blocking.
- Rewriting `apps/cli/src/commands/` for organization/structure beyond what each implementation PR naturally touches. Refactors that don't serve a specific phase's implementation are out.
- Replacement of the OAuth path with anything else; API-key auth is additive, not a replacement.

## Dependencies / Assumptions

- API surfaces (`packages/api`, REST handlers in `packages/lambda`) already exist for most stub commands — the CLI implementations are mostly thin GraphQL / REST clients. Each phase's planning step should confirm the backing API exists or note when a backend addition is required.
- `apps/cli/src/lib/gql-client.ts` and the codegen pipeline (`pnpm --filter thinkwork-cli codegen`) are the standard wiring for new API-side commands; no new client layer is added.
- The CLI continues to publish to npm as `thinkwork-cli` with `thinkwork` as the bin name; no rename or relicensing in scope.
- The Node ≥ 22 / pnpm ≥ 9 floor stays as the supported development toolchain (per repo `CLAUDE.md`). CLI users only need Node ≥ 20 (current `engines.node`).

## Findings From This Brainstorm

- **F1** — `thinkwork login` verb collision: deploy-mode and API-mode share one verb with no scent trail. Addressed by R6.
- **F2** — Tenant-unresolved error buries the obvious fix in a comma list. Addressed by R7.
- **F3** — Real concrete use case anchoring this work: *"I want to run an eval category from my terminal."* This is the canonical motivating scenario; if the eval-from-CLI flow isn't great after R6+R7, the rest of the roadmap is academic.
