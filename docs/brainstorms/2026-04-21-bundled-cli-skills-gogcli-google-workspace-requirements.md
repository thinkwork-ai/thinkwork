---
date: 2026-04-21
topic: bundled-cli-skills-gogcli-google-workspace
---

# Bundled-CLI Skills (v1: gogcli / Google Workspace)

## Problem Frame

ThinkWork agents today reach Google Workspace through two thin Python skills — `packages/skill-catalog/google-email/scripts/gmail.py` and `google-calendar/scripts/gcal.py` — that wrap the Gmail and Calendar REST APIs directly with a user OAuth access token injected via `GMAIL_ACCESS_TOKEN`. The token is pre-refreshed server-side by `packages/api/src/lib/oauth-token.ts` and handed to the agent container fresh per invocation.

That path works, but two things are converging:

1. **Coverage gap.** Agent templates increasingly want Drive, Docs, Sheets, and Tasks — not just mail and calendar. Hand-porting each Google product into a new Python skill is linear work per product and carries ongoing upkeep cost.
2. **CLI-as-skill has become the better primitive for mature community CLIs.** The same pattern would apply to `gh` for GitHub, `stripe` for payments, `linear` for project management, `aws` for infra tasks, etc. Each of those is a mature, battle-tested CLI we'd otherwise be re-implementing in Python one subcommand at a time. The current Python-skill shape does not declare "this skill needs a binary bundled into the Docker" as a first-class concept; every CLI integration would have to reinvent the packaging + env-injection story.

The specific trigger is `gogcli` (https://github.com/steipete/gogcli/releases/tag/v0.13.0) — a Go CLI covering Gmail, Calendar, Chat, Drive, Docs, Sheets, Slides, Tasks, Contacts, Forms, and more, with JSON-first output, an explicit agent mode (`--no-input`, `--disable-commands` command allowlist, `--access-token` / `GOG_ACCESS_TOKEN`, `--readonly` / `--gmail-scope` / `--drive-scope` least-privilege flags, `--gmail-no-send` safety guard), and active community maintenance. Its headless-auth contract is a drop-in fit for our existing per-invocation token-injection model.

So this brainstorm solves two problems together: (a) define the reusable "bundled CLI as a skill" shape so future CLI integrations are additive, not bespoke; (b) use gogcli to expand Google Workspace coverage from Gmail+Calendar to include Drive+Docs+Sheets, retiring the two hand-maintained Python skills.

**Non-premise: "CLI > MCP."** steipete's README frames gogcli as superior to Google MCP servers; that framing is valid in a human-at-desktop context where a human uses Claude Desktop. In an autonomous-agent-loop context, typed tool schemas (MCP tool defs, Python tool functions with JSON schemas) remain more reliable for Claude/Strands than free-form shell + stdout parsing. This brainstorm therefore wraps gogcli subcommands as typed Python tools; it does not hand agents raw bash.

## Requirements

**Pattern Substrate — Bundled-CLI Skills**

- R1. The skill manifest format (today: `skill.yaml` + `SKILL.md` + `scripts/`) gains a first-class way to declare a **bundled binary** as part of a skill: binary name, source (download URL with checksum or vendored path), target platform, version. A skill of this shape is referred to as a *bundled-CLI skill*.
- R2. The agent Docker build process installs declared bundled binaries into the container image at known paths reachable from every skill's Python wrapper (e.g. `/usr/local/bin/<name>`). Install happens at image-build time, not per-invocation.
- R3. Bundled-CLI skills remain typed at the agent tool boundary: each callable subcommand is exposed as a Python tool function with a JSON-schema-shaped signature, shelling out to the CLI internally. Agents do **not** receive a raw shell or bash tool as a result of this work.
- R4. Bundled-CLI skills declare their **credential injection contract** — which environment variable(s) the binary expects, and how they map onto our existing credential sources (OAuth access token, static API key, service account JSON, etc.). The skill runner is responsible for setting these per invocation, scoped to the invoking user, and unsetting them after.
- R5. Bundled-CLI skills declare a **command allowlist** (safe subcommands + flag constraints) in the skill manifest. At runtime, two enforcement layers apply: (a) the Python wrapper only exposes allowlisted subcommands as tools; (b) when the CLI itself supports a command allowlist flag (e.g. gogcli's `--disable-commands`), the runner passes it as defense in depth.
- R6. The skill manifest supports **per-agent-assignment tightening** of the allowlist, consistent with the existing `assignCfg.toolAllowlist` pattern already used for MCP tools (`packages/api/src/lib/mcp-configs.ts`). Skill-level sets the maximum; agent-assignment can only narrow, never expand.
- R7. Non-interactive operation is mandatory: skill wrappers pass whatever flag the CLI uses to suppress interactive prompts (gogcli: `--no-input`), and select JSON output where offered (gogcli: `--json`). Stdout is parsed into structured Python values before return; stderr is captured separately and logged, not returned.

**gogcli / Google Workspace v1**

- R8. A new skill — working name `google-workspace` — replaces the existing `google-email` and `google-calendar` Python skills. It uses `gogcli` as the bundled binary per R1–R2.
- R9. The v1 tool surface exposes typed Python wrappers for at minimum the product coverage we ship in v1: Gmail (search, send, list threads, manage labels, manage drafts), Calendar (list/create/update/delete events, free/busy), Drive (list, search, upload, download, permissions, markdown-to-Doc convert), Docs (create, get, export to Markdown, find/replace), Sheets (read range, write range, append rows, create sheet). The *exact* subcommand set per product is a planning deliverable; v1 coverage must be at least these five products.
- R10. Credential injection uses `GOG_ACCESS_TOKEN` (equivalent to gogcli's `--access-token`), sourced from the invoking user's existing Google OAuth connection and refreshed server-side per invocation via the current `oauth-token.ts` path. No new OAuth infrastructure is built.
- R11. Google OAuth consent scopes are broadened from the current Gmail+Calendar set to the full v1 surface (Gmail, Calendar, Drive, Docs, Sheets). The broader-scope rollout mechanism for existing connected users is a planning-level concern (R-Q3 below).
- R12. Default tool posture for the `google-workspace` skill is **least-privilege**: `--gmail-no-send`, `--readonly` applied to Drive/Docs/Sheets, and send/write subcommands gated behind an explicit agent-assignment opt-in in the agent-template configuration. Write-enabled assignment still honors user consent and tenant policy.
- R13. The skill exposes skill-level metadata surfacing which Google products and which action types (read-only vs write) are currently enabled for a given agent assignment, so admin UI and mobile self-serve can display it honestly (consistent with `feedback_user_opt_in_over_admin_config`).

**Migration & Compatibility**

- R14. The existing `packages/skill-catalog/google-email/` and `google-calendar/` directories are removed once `google-workspace` reaches parity for their current responsibilities. No parallel maintenance of both code paths.
- R15. Agent templates already bound to `google-email` / `google-calendar` get migrated to `google-workspace` with equivalent capability, in a single coordinated change. Agents do not see a gap in capability at migration time.
- R16. The migration preserves existing user OAuth connections (`connections` + `credentials` rows for Google). Users are not forced to re-run the entire OAuth flow from scratch; however, they may be prompted to grant additional scopes (Drive/Docs/Sheets) on the next interaction that needs them. The exact UX pattern for scope expansion is a planning concern (R-Q3).
- R17. Evals, snapshots, and test cases that reference the legacy `google-email` / `google-calendar` skill IDs get updated to `google-workspace` or deleted if the underlying scenario is superseded.

**Observability & Safety**

- R18. Every gogcli invocation is logged with: invoking user id, agent id, skill id, subcommand + flags (sanitized — no access token), exit code, stderr tail, and latency. This is a new log shape for CLI subprocess calls; it should be consistent across all future bundled-CLI skills.
- R19. Access tokens are never logged, never persisted to disk inside the container, and never written into the agent's visible context. The token lives only in the subprocess env for the duration of one invocation.
- R20. The container image is reproducibly built: gogcli binary is pinned to a specific release tag with SHA-256 verification at Dockerfile install time. Bumping gogcli is an intentional PR, not a moving target.

## Success Criteria

- An agent template authored against `google-workspace` can perform the following end-to-end without hand-coded Python: search Gmail → open a matching thread, create a Calendar event from message content, create a Google Doc with a meeting summary, share the Doc with an attendee via Drive permissions, and append a row to a tracking Sheet. All via typed tool calls, no shell.
- A second bundled-CLI skill (expected later — `gh`, `stripe`, or similar) can be authored with no changes to the core skill runner or agent Docker structure; only a new skill manifest + Python wrappers.
- Existing users with a Google connection are not logged out and do not re-complete OAuth from zero. They experience at most an incremental consent step when an agent first needs a newly-added scope.
- A new-hire engineer can read the skill manifest + `SKILL.md` for `google-workspace` and understand (a) which binary runs, (b) which tokens flow in, (c) which subcommands are exposed, (d) which are write-enabled, (e) how to extend coverage — without reading the skill runner source.
- The agent Docker image build remains under a reasonable size delta from adding gogcli (measured: ~26 MB for v0.13.0 linux/amd64 extracted, ~9.4 MB compressed in the release tarball). Target: ≤35 MB binary size contribution, to leave headroom for gogcli's growth as it covers more Google products.
- No regression in existing Gmail/Calendar agent behavior at parity; the two retired Python skills' happy paths are covered by `google-workspace` on day one of the switchover.

## Scope Boundaries

- **Out of scope: raw bash tools for agents.** Rejected in Phase 2; agents get typed wrappers only.
- **Out of scope: running gogcli as an MCP server.** Our MCP path is reserved for actual remote MCP servers (`tenant_mcp_servers`, `user_mcp_tokens`). Bundled CLIs live in the skill runtime, not the MCP runtime.
- **Out of scope: replacing other existing skills with bundled-CLI equivalents in this v1.** Only the two Google Python skills get retired. `gh`, `stripe`, `linear`, etc. are follow-up work that re-uses the pattern; they are not shipped in v1.
- **Out of scope: gogcli's service-account / domain-wide-delegation flow.** v1 is per-user OAuth only, consistent with `project_mobile_auth_google_oauth` (users connect their own Google). Workspace-tenant service accounts can land later if there is demand.
- **Out of scope: gogcli's multi-OAuth-client setup (`--client`, `account_clients`, `client_domains`).** We use one ThinkWork Google OAuth client across all users; per-client bucketing is not needed.
- **Out of scope: gogcli's interactive auth (`gog auth add`, `--manual`, `--remote`).** All auth is resolved by `oauth-token.ts` before the container ever runs. gogcli's keyring is never written.
- **Out of scope: exposing gogcli's keyring or on-disk config to the agent container.** The container runs with `--access-token` only; no persistent gogcli state.
- **Out of scope: user-facing skill granularity redesign.** Whether `google-workspace` is presented in the admin/mobile UI as one connection or as a product picker (Gmail on, Drive off, etc.) is a UX question flagged below, not a v1 product decision.
- **Out of scope: a new "bundled binary" tenant admin UI.** Skill manifest + manifest validation lives in the repo, not in an admin editor. Tenants do not upload custom binaries.
- **Out of scope: AWS Bedrock AgentCore Evaluations integration for gogcli outputs specifically.** Evaluations stack (`project_evals_scoring_stack`) observes agent turns generically; no gogcli-specific scorer is shipped in v1.

## Key Decisions

- **Typed Python wrappers over raw shell.** Ruled in Phase 2 based on agent tool-call reliability. The CLI is an implementation detail under a typed tool surface; agents never see the shell syntax. gogcli's `--json` + stable flags make this tractable.
- **Binary baked into the Docker image at build time, pinned + checksummed.** Rejected lazy download-at-install-time: adds per-invocation latency, complicates supply-chain verification, and fights the reproducible-build property. Bumping gogcli becomes an explicit PR — the right behavior for a binary executing in a production agent runtime.
- **Credential contract: environment-variable injection per invocation, never persisted.** Matches our current skill pattern (`GMAIL_ACCESS_TOKEN`). gogcli's `GOG_ACCESS_TOKEN` is a drop-in rename; `oauth-token.ts` refresh logic is unchanged.
- **Two-layer command allowlist: skill manifest declares maximum safe set, agent-assignment config tightens further.** Consistent with the existing `assignCfg.toolAllowlist` shape for MCP. Prevents a misconfigured agent template from exposing a dangerous subcommand that the skill author never sanctioned.
- **Least-privilege-by-default for writes.** `--gmail-no-send`, `--readonly` on Drive/Docs/Sheets applied unless explicitly opted in per agent assignment. Rationale: most agent templates need to *read* Workspace data; only a small minority need to send email or mutate documents. Defaulting to read keeps the blast radius small.
- **Consolidate `google-email` + `google-calendar` into one `google-workspace` skill, not three or five.** Users already connect a single Google account for all their Workspace data. One skill lines up with one OAuth connection. Product-level splits (Gmail-only agent, Drive-only agent) happen via allowlist, not separate skill registrations.
- **Retire the Python skills, don't coexist.** Short migration is better than long divergence. Two code paths for "send an email" invites drift. The switchover is coordinated with the OAuth scope broadening in one cross-cutting change.

## Dependencies / Assumptions

- Assumes `packages/api/src/lib/oauth-token.ts`'s Google refresh path continues to work as it does today and can be extended to request additional scopes (Drive/Docs/Sheets) without structural change. If the refresh logic is scope-locked to Gmail+Calendar, that's a planning-level fix — not a blocker but worth flagging early.
- Assumes `connections` + `credentials` + the existing per-user Google OAuth client registration (memory: `project_google_oauth_setup`) can be extended with additional scopes via Google Cloud Console without recreating the OAuth client. This is standard Google behavior.
- Assumes the Strands Agent SDK accepts typed Python tool functions that internally shell out to subprocesses without requiring the tool to be declared differently from a pure-Python tool. (Verified by reading `google-email/scripts/gmail.py` — today's pattern.)
- Assumes gogcli's release cadence and stability are acceptable for inclusion in a production agent container. As of 2026-04-21, v0.13.0 is the latest tag; v1 pins to a specific tag and re-evaluates cadence before the next bump.
- Assumes the existing `feedback_user_opt_in_over_admin_config` holds: users opt into integrations via mobile self-serve, admins do not configure them on users' behalf. The scope-expansion UX for Drive/Docs/Sheets must surface in mobile self-serve (or on next relevant agent interaction), not as an admin toggle.
- Assumes `project_memory_scope_refactor` does not block this: that refactor is about per-user memory/wiki scoping and the paused MCP *inbound-server* work. This is outbound agent-to-Google work via skills. No overlap.

## Outstanding Questions

### Resolve Before Planning

(none — proceed to `/ce:plan`)

### Deferred to Planning

- **[Affects R1, R2][Technical]** Exact skill-manifest schema shape for declaring a bundled binary — field names, platform/arch handling (linux/amd64 only for now, since the container is linux/amd64; multi-arch is deferred), checksum format (sha256 hex recommended), version-pinning discipline. The skill-catalog loader in `packages/skill-catalog/` and the Dockerfile at `packages/agentcore-strands/agent-container/Dockerfile` are the concrete touchpoints.
- **[Affects R9][Needs research]** Full per-product subcommand coverage matrix for v1 — which gogcli subcommands become typed tools vs. deferred. Source of truth is `gog --help` recursively plus gogcli's `docs/commands.generated.md`. Planning should produce a concrete tool-inventory table before implementation starts.
- **[Affects R11, R16][Needs research]** OAuth scope-expansion rollout mechanics for existing connected users. Options: (a) broaden scope-list in the OAuth client immediately so new auth flows request full set; existing tokens keep their narrower grants until next refresh-or-re-auth; (b) trigger explicit re-consent on next agent interaction that requires a newly-added scope; (c) add a mobile-self-serve banner prompting re-consent. Google's own behavior differs by scope type (incremental vs full re-consent). Planning should validate empirically, not guess.
- **[Affects R5, R6, R12][Technical]** Representation of the allowlist in agent-template config vs. runtime resolution. Should the skill manifest's allowlist be a flat list of subcommand names, a regex-pattern list, or a structured per-subcommand object with per-flag constraints? The existing MCP `toolAllowlist` is a flat string array; consistency argues for the same, but gogcli has enough flag-level nuance (`--gmail-no-send` is a modifier, not a subcommand) that this may not be sufficient.
- **[Affects R18][Technical]** Logging surface: does the subprocess wrapper emit a structured log line to stdout/stderr (picked up by AgentCore runtime observability), to a dedicated CloudWatch log group, or to the existing hindsight/observability pipeline? Decide alongside the existing observability stack rather than inventing a new path.
- **[Affects R12][Technical]** Which specific gogcli flags map to each of "read-only Drive", "read-only Docs", "read-only Sheets", "no-send Gmail", etc. Some are documented in gogcli README (`--readonly`, `--gmail-no-send`, `--drive-scope`, `--gmail-scope`); some may require a Python-wrapper layer that refuses to emit mutating subcommands rather than rely on a CLI flag.
- **[Affects R14, R15][Technical]** Migration-day coordination: is there any agent template in flight that would break mid-migration if `google-email` / `google-calendar` disappeared before `google-workspace` is bound? Planning should audit current agent-template skill assignments before scheduling the switchover.
- **[Affects R15][Technical]** Whether the retirement of the Python skills requires updating `agent-templates` snapshot rows (`packages/api/src/lib/agent-snapshot.ts`) or rewriting any tenant workspace-copy code (`packages/api/src/lib/workspace-copy.ts`) that expects the old skill slugs.

## Next Steps

-> `/ce:plan` for structured implementation planning
