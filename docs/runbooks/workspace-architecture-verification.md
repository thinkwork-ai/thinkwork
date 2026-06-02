---
title: "Workspace Architecture Verification"
date: 2026-06-01
status: active
---

# Workspace Architecture Verification

Use this runbook after workspace-shape migrations, workspace renderer changes,
desktop/mobile cache changes, or Pi runtime bootstrap changes.

The two trees below are both correct, but they are different by design.

## Expected source workspace

Settings -> Workspace is the editable source workspace. It should show exactly
these top-level folders:

```text
Workspace
├── Agent
├── Spaces
└── User
```

Expected source details:

- `Agent` contains root files such as `AGENTS.md`, `CONTEXT.md`, `GUARDRAILS.md`,
  `MEMORY_GUIDE.md`, plus folders such as `skills/` and `workspaces/`.
- `Spaces` contains one child folder per readable Space by name, for example
  `customer-onboarding/`, `default/`, or `general/`.
- A Space detail folder contains its files directly: `CONTEXT.md`, `artifacts/`,
  `docs/`, `goals/`, and `plans/`. It should not contain a `source/` wrapper.
- `User` contains `USER.md` and user memory files such as `memory/`.

Forbidden source folders:

- `workspace/` under `Agent`
- `source/` under a Space
- `workspace-archives/`
- raw UUID folders
- generated petname tuple folders

## Expected rendered runtime workspace

A Pi turn hydrates a rendered sandbox into `/workspace`. It is not the same tree
as Settings -> Workspace.

```text
/workspace
├── AGENTS.md
├── CONTEXT.md
├── skills/
├── workspaces/
├── Spaces/
│   ├── INDEX.md
│   └── customer-onboarding/
│       ├── SPACE.md
│       ├── CONTEXT.md
│       ├── artifacts/
│       ├── docs/
│       ├── goals/
│       ├── plans/
│       └── workflows/
├── User/
│   ├── USER.md
│   └── memory/
└── Thread/
    ├── THREAD.md
    ├── GOAL.md
    ├── PROGRESS.md
    ├── TASKS.md
    └── notes/
```

The Agent source is the runtime root. The User source remains explicit under
`User/`. Only the active Space folder is hydrated under `Spaces/<active-space>/`;
`Spaces/INDEX.md` lists other authorized Spaces.

Forbidden runtime folders:

- `/workspace/Agent`
- `/workspace/Space`
- `/workspace/USER.md`
- `/workspace/workspace`
- `/workspace/source`
- `/workspace/workspace-archives`

Local SDK runtimes may create implementation directories such as
`.thinkwork-pi`. They should be hidden from user-facing inspectors and skipped
by diffing, but their presence on disk is not a workspace-shape failure.

## Settings verification

1. Open Settings -> Workspace.
2. Confirm top-level roots are `Agent`, `Spaces`, and `User`.
3. Expand `Agent`; confirm root files are direct children and `workspace/` is not
   present.
4. Expand one Space under `Spaces`; confirm its files are direct children and
   `source/` is not present.
5. Expand `User`; confirm `USER.md` and `memory/` are visible for the current
   user.

If a root is missing, verify the workspace-files API target first: Agent target,
Space target, and User target are separate S3-backed sources that the
consolidated Settings view prefixes for display.

## Runtime smoke

Send a turn that uses bash and asks for:

```bash
pwd
printf '%s\n' ---
find . -maxdepth 2 -type d -print | sort
printf '%s\n' ---
test -f USER.md && echo USER.md exists || echo USER.md missing
test -f User/USER.md && echo User/USER.md exists || echo User/USER.md missing
test -f Spaces/INDEX.md && echo Spaces/INDEX.md exists || echo Spaces/INDEX.md missing
test -d Space && echo legacy Space exists || echo legacy Space missing
```

Expected:

- `pwd` reports `/workspace`.
- `USER.md missing`.
- `User/USER.md exists`.
- `Spaces/INDEX.md exists`.
- `legacy Space missing`.
- No top-level `Agent`, singular `Space`, root `USER.md`, `workspace`, `source`, or
  `workspace-archives` directories.

## Sync and hydration timing

Workspace sync is cache-aware. A runtime should check source/manifest freshness
and hydrate changed files; it should not download the whole tenant bucket before
every turn.

Look here when a turn spends too long before the model starts:

- AgentCore: phase logs around workspace render, workspace bootstrap,
  session-store setup, SDK session creation, and prompt start.
- Desktop/mobile: client submit, subscription, and render logs around the
  managed turn; they do not hydrate or execute a local Pi workspace.
- API: workspace renderer logs for manifest generation/cache hit behavior.

When debugging a slow "read USER.md" turn, separate these phases:

1. source render/cache check
2. local hydration
3. SDK/session creation
4. model/tool execution
5. finalize/reconcile

Only optimize after the slow phase is known.

## Ownership reminder

- Files own working and narrative content.
- The database owns task status, Goal lifecycle, review policy, access, and
  thread binding.
- `Thread/GOAL.md`, `Thread/PROGRESS.md`, and `Thread/TASKS.md` are read-only
  projections of database state.
- Task completion should use the task-status path. Editing
  `Thread/PROGRESS.md` text is not authoritative.
