# `@thinkwork/factory` — the compound-engineering factory daemon

A single **Linear-polling dispatch daemon** that runs the compound-engineering
pipeline (brainstorm → plan → implement → verify → compound) as disposable,
headless `claude -p` / `codex exec` workers in isolated git worktrees. It keeps
all durable state in **Linear** (status + a rolling ledger comment) and its own
sqlite store, and converses with the operator over a **Slack** channel (one
thread per issue). One daemon is the single dispatch authority — there is no
second lane racing it.

It replaces the never-run two-lane dispatcher: label an issue, and the factory
walks it to a merged PR autonomously.

---

## Quickstart

Everything runs through the package CLI (`factoryd` = `tsx src/cli.ts`) from the
package directory. On the operator machine (the "mini"):

```bash
cd /path/to/thinkwork/packages/factory

# 0. Deps (from the repo root, once): pnpm install

# 1. Write the config (see "Configuration" below). Lives OUTSIDE the repo:
#    ~/.thinkwork-factory/config.json  (chmod 600 — it holds live secrets)
cp config.example.json ~/.thinkwork-factory/config.json
chmod 600 ~/.thinkwork-factory/config.json
$EDITOR ~/.thinkwork-factory/config.json

# 2. Preflight — validates config, store, Linear API, claude/codex bins, gh auth
node_modules/.bin/tsx src/cli.ts doctor

# 3. Install as launchd LaunchAgents (daemon + watchdog), starts immediately
node_modules/.bin/tsx src/cli.ts install

# 4. Confirm it's up
launchctl list | grep factory
node_modules/.bin/tsx src/cli.ts status
tail -f ~/.thinkwork-factory/logs/daemon.log
```

To **start the factory on an issue**: in Linear, add a lane label (`Claude` or
`Codex`) and move the issue to **`Brainstorming`** (or any later state — see
[Enrollment model](#enrollment-model)). The daemon picks it up on the next tick.

Common lifecycle commands (see [Operating the daemon](#operating-the-daemon) for
the full set):

```bash
UID=$(id -u)
# restart after a code update
launchctl kickstart -k gui/$UID/com.thinkwork.factory
# stop
launchctl bootout gui/$UID/com.thinkwork.factory
launchctl bootout gui/$UID/com.thinkwork.factory-watchdog
# run once in the foreground (a single tick, then exit)
node_modules/.bin/tsx src/cli.ts run --once
```

> `pnpm --filter @thinkwork/factory dev -- <command>` is equivalent to
> `node_modules/.bin/tsx src/cli.ts <command>` if you prefer to run from the repo
> root.

---

## How it works

Each **poll tick** (default every 30s):

1. **Poll** Linear for candidate issues (the enrollment filter below).
2. **Decide** one action per issue from the routing-contract status table —
   `launch` a phase worker, `advance` a status, `wait` for a human gate,
   `block` on a blocker label, or `noop`.
3. **Execute** the action: spawn a detached worker in a fresh worktree, move
   status, or post a block. Workers are disposable — they read the Linear
   ledger + attached `Progress:` doc, do one phase, leave evidence (a handoff
   comment, a merged PR, an updated ledger), and exit.
4. **Sync Slack** — open/track the issue thread, mirror a `Needs User` question
   as an @mention, post phase milestones. All best-effort; a Slack outage never
   blocks the pipeline.
5. **Reconcile & un-enroll** — detect dead workers, and wind down any issue that
   left the active queue (moved to Backlog/Todo/Canceled, lost its lane label,
   or finished).

Durable state lives in three places, with **Linear as the source of truth**:

- **Linear**: issue status (the pipeline position) + one rolling
  `automation-ledger:<ID>` comment (phase, lane, worker, attempt, blocker,
  compounded) + the attached `Progress: <title>` document.
- **sqlite store** at `~/.thinkwork-factory/factory.db`: leases, attempts,
  worker pids, Slack thread mappings, nag/idempotency markers. Operational, not
  authoritative — it can be rebuilt from Linear by the reconciler.
- **git worktrees** under `~/.thinkwork-factory/worktrees/auto-<issue>-<phase>-<attempt>`:
  one per worker, branched from fresh `origin/main`, removed on completion.
- **durable artifacts** under `~/.thinkwork-factory/artifacts/<ISSUE>/`: verify
  workers copy their screenshots here (`NN-scenario-slug.png`) so evidence
  survives worktree cleanup; the Slack console's `result` command reads them
  back. No retention policy in v1 — prune by hand if disk pressure appears.

### Enrollment model

An issue is a **candidate** when it is either:

- **lane-labeled** (`Claude` or `Codex`) **and** in an active workflow state at
  or above the enrollment floor, **or**
- in a **Verification-family** state (`Verification` / `Review`), regardless of
  lane (verification is always Claude-lane-owned).

**The enrollment floor is `Brainstorming`.** Active states, in order:

```
Brainstorming → Requirements Review → Planning → Plan Review
             → Ready to Work → In Progress → (Verification/Review)
Debug is also a trigger (diagnosis lane).
```

Key rules:

- **`Todo` is below the floor — the daemon ignores it entirely.** A lane-labeled
  Todo issue is ideation you still own (`ce-ideate`). Moving an issue **into**
  `Brainstorming` is your explicit "start the factory" gesture; the daemon does
  not auto-advance Todo. An enrolled issue you move **back** to Todo (or Backlog)
  is un-enrolled (its worker wound down, thread closed).
- **`LFG`** widens what a phase may do (autopilot through the review gates); it
  does **not** widen the filter. Without `LFG`, the daemon stops at
  `Requirements Review` / `Plan Review` / `Verification` and waits for a human.
- **Blocker labels** (`Needs User`, `Needs Credentials`, `Unsafe Ambiguity`,
  `CI Failed`, `Blocked: Auth`) stop automation until removed.
- **Both lane labels** on one issue is a lane conflict → the daemon marks it
  `Needs User` and asks you to pick a lane.
- **LFG never-stuck doctrine.** An LFG issue with a known next action must
  never sit waiting on a human: parent issues WAIT quietly while their child
  issues are in flight and resume automatically when all children are Done
  (never a `Needs User` block); a worker gated on another issue records
  `waiting-on THINK-x` in its ledger blocker and the daemon relaunches the
  phase automatically when THINK-x reaches Done; and LFG workers self-answer
  any question they can pair with a recommendation. With LFG, `Needs User`
  is reserved for missing credentials, unsafe-irreversible ambiguity, and
  repeated real failures (the attempt ceiling).
- **`Done` is terminal — the factory never touches a Done issue.** Auto-compound
  is **disabled**: Done is not even enrolled (it costs zero API requests per
  tick — keeping the board's finished issues enrolled is what blew the Linear
  2,500 req/hr key limit). An enrolled issue that reaches Done is wound down as
  **completed** (closing summary, nothing killed) by the un-enroll pass. Run
  `ce-compound` manually when you want to distill learnings from a completed
  issue.

The canonical semantics live in
`.agents/skills/thinkwork-linear-dispatcher/references/routing-contract.md`; the
code's single source of truth for the vocabulary is `src/domain/statuses.ts`.

### Phases

| Phase       | Worker         | Default model | Wall-clock SLA |
| ----------- | -------------- | ------------- | -------------- |
| `brainstorm`| ce-brainstorm  | fable         | 45 min         |
| `plan`      | ce-plan        | fable         | 45 min         |
| `debug`     | ce-debug       | opus          | 60 min         |
| `implement` | ce-implement   | fable         | 120 min        |
| `verify`    | dogfood verify | opus          | 60 min         |
| `compound`  | ce-compound    | sonnet        | 30 min         |

**`compound` is not auto-launched** — auto-compound is disabled, so the daemon
never dispatches it (a Done issue is a pure noop). The phase config remains for
running `ce-compound` manually. Defaults live in `DEFAULT_PHASES` (`src/config.ts`)
and are overridable per
phase in config. Workers are governed by the **wall-clock SLA** and a
**silence/stall budget**, not a dollar cap (subscriptions have no real spend —
see `enforceBudgetUsd`).

---

## Prerequisites

- **macOS** with **launchd** (the daemon installs as per-user LaunchAgents).
- **Node ≥ 22** and **pnpm ≥ 9** (`pnpm install` at the repo root so
  `node_modules/.bin/tsx` resolves). The daemon runs from **source** via `tsx`
  — there is no build step.
- **`claude`** CLI (and **`codex`** for the Codex lane) installed with absolute
  paths, authenticated and able to run headless from a non-login shell.
- **`gh`** CLI authenticated (workers open/merge PRs).
- A **Linear** personal API key for the account that should author factory
  activity, and the team key.
- *(optional)* A **Slack** app for the operator surface (see [Slack setup](#slack-setup)).
- For **24/7 reboot survival**: macOS **auto-login ON** and **FileVault OFF**, so
  the LaunchAgent starts on boot without a manual unlock. `install` warns if
  these are not set.

---

## Configuration

Config lives at `~/.thinkwork-factory/config.json` (override the directory with
`THINKWORK_FACTORY_DIR`). **It holds live secrets — `chmod 600`, never commit
it.** Start from `config.example.json`.

```jsonc
{
  "linear": {
    "apiKey": "lin_api_…",        // personal API key; this account authors factory activity
    "teamKey": "THINK",
    "trustedUserIds": []           // extra Linear user ids whose comments may steer workers
  },
  "slack": {                        // optional block; omit entirely for Linear-only
    "botToken": "xoxb-…",          // enables Slack when present
    "appToken": "xapp-…",          // required for Socket Mode (the inbound answer relay)
    "channelId": "C…",             // where per-issue threads are posted
    "operatorUserIds": ["U…"],     // allowlist: only these users' replies are injected
    "webhookUrl": "https://hooks.slack.com/…"  // watchdog daemon-down alert
  },
  "hosts": [
    {
      "name": "mini",
      "kind": "local",             // "local" | "ssh"
      "repoPath": "/Users/you/Projects/thinkwork",  // absolute checkout the daemon deploys/runs from
      "capabilities": ["claude", "codex"],          // "browser-auth" for the verify host
      "maxConcurrent": 2,
      "claudeBin": "/absolute/path/to/claude",
      "codexBin": "/absolute/path/to/codex"
    }
    // an "ssh" host adds "sshTarget": "user@host"
  ],
  "phases": {},                     // {} = defaults; override any phase's model/SLA/budget here
  "pollIntervalSeconds": 30,
  "enforceBudgetUsd": false         // true only on API-billed hosts (see below)
}
```

Notes:

- **`linear.apiKey`** — the daemon acts as this Linear user. Only this user's
  comments (plus `linear.trustedUserIds`) can steer a worker prompt or count as
  phase evidence; anyone else's comments are informational.
- **Slack is optional and additive.** With no `slack` block (or no `botToken`)
  the daemon runs Linear-only. A *half*-configured Slack (bot token but no app
  token / channel) is a **startup error** — the daemon fails loudly rather than
  run with a silently-dead surface. An enabled Slack with an empty
  `operatorUserIds` warns: replies are acknowledged but injected for no one.
- **`enforceBudgetUsd`** — default `false`. On a subscription the per-phase
  `budgetUsd` is notional, so enforcing it as `--max-budget-usd` could kill
  legitimate long work. Set `true` only on a host where reported cost is real
  API spend. The real governors are the wall-clock SLA + stall detection.
- **`hosts[].capabilities`** — `browser-auth` marks the host that can run
  dogfood verification (a real browser session against deployed dev).

### Slack setup

1. Create a Slack app; enable **Socket Mode** (this mints the `xapp-…`
   app-level token used for the inbound answer relay).
2. Bot token scopes — `chat:write`, `channels:read` + `channels:history`
   (add `groups:read` + `groups:history` for a private channel), plus the
   operator-console scopes: `pins:read` + `pins:write` (the pinned live
   board) and `files:write` (`result` uploads verification screenshots
   inline). `factoryd doctor` probes `pins:read`; the write scopes surface a
   `missing_scope` error on first use if forgotten.
3. Event subscriptions: `message.channels` (and `message.groups` for a private
   channel) — this is how the bot sees your in-thread replies.
4. Enable **Interactivity & Shortcuts** — required for the answer-form buttons
   (no Request URL needed; Socket Mode carries the click payloads). Without it,
   buttons render but clicks silently go nowhere.
5. Install to the workspace; invite the bot to the factory channel.
6. Put the **bot token** (`xoxb-…`), **app-level token** (`xapp-…`, Socket
   Mode), **channel id**, and your **member id** in `operatorUserIds` into
   config. `webhookUrl` (an incoming webhook) is used by the watchdog to alert
   when the daemon goes silent.
7. Create a **`Paused`** label in Linear (any color) — the console's
   `pause`/`resume` verbs flip it, and the poller treats it as a blocker
   label.
8. Operator-account hygiene: the allowlisted Slack account now carries merge
   and release authority — keep Slack **2FA enabled** on it.

### Operator console (Slack)

Every factory message carries the buttons valid for the issue's current
state; each button has a typed equivalent usable in the same thread. All
verbs — including the read-only ones — are gated on `operatorUserIds`.

| Verb | Does | Notes |
|---|---|---|
| `approve` (alias `advance`) | advance the current review gate | Requirements Review → Planning, Plan Review → Ready to Work, Verification → Done |
| `result` (alias `report`) | newest handoff, merged PRs, report links, screenshots | screenshots upload inline from `~/.thinkwork-factory/artifacts/<ISSUE>/` |
| `logs [n]` | tail of the newest worker log (default 40 lines) | active attempt first, else latest |
| `merge <pr#>` | squash-merge a factory PR | refuses PRs not associated with the thread's issue; shows checks first |
| `retry` | relaunch the current phase from its newest baton | no-op while a worker is running |
| `pause` / `resume` | suspend / restore automation on the issue | flips the `Paused` Linear label |
| `release` | cut a release (tags per the configured scheme) | confirm round-trip: shows the exact tags + origin/main sha; only the confirm tap executes, and only at that sha |
| `status` | in a thread: that issue; at channel root: the board snapshot | |
| `question` | re-show the open question without answering it | |
| `help` | list the commands valid for the issue's state | any unrecognized message shows this too |

**Buttons per state:** review gates (Requirements Review / Plan Review /
Verification) show ✅ Approve · 📄 Result · 🪵 Logs · 🔁 Retry · ⏸ Pause;
working states drop Approve; Done shows Result only; a paused issue shows
▶️ Resume. A merged factory PR posts a note with 🚢 Cut release · 📄 Result.

**Pinned board:** one channel message, edited silently every tick — running
(with elapsed), needs-you, waiting, paused, done-today, idle counts. Rows
link to their Slack threads. If it gets unpinned or deleted, the daemon
re-posts and re-pins it on the next tick.

**Repo-scoped verbs — release and deploy (THINK-286):** `release` and
`deploy <target>` act on the repo/stacks, not an issue, so they work from
**any thread and from the channel root** (plain channel message). Both are
gated behind a confirm round-trip that shows exactly what will run.

`deploy <target> [<version-tag>]` targets come from `deployTargets` in the
factory config — per-target argv/env/cwd with a `<VERSION>` placeholder
resolved to the newest release tag (or the version you typed):

```jsonc
"deployTargets": {
  "tei": {
    "argv": ["pnpm", "--dir", "apps/cli", "dev", "release", "deploy", "<VERSION>", "--stage", "tei-e2e", "--yes"],
    "env": { "AWS_PROFILE": "tei", "AWS_REGION": "us-east-1" },
    "note": "TEI customer stage"
  },
  "mcpherson": {
    "argv": ["pnpm", "--dir", "apps/cli", "dev", "release", "deploy", "<VERSION>", "--stage", "mcpherson", "--yes"],
    "env": { "AWS_PROFILE": "mcpherson", "AWS_REGION": "us-east-1" },
    "note": "McPherson customer stage"
  }
}
```

Confirmed deploys run **detached** (they outlive daemon restarts) with output
at `~/.thinkwork-factory/logs/deploy-<target>-<ts>.log`; the daemon posts the
outcome to the channel when the process exits (log tail on failure). One
deploy per target at a time. Customer stages use the `release deploy` flow —
see `docs/solutions/workflow-issues/customer-updates-use-release-deploy-not-deploy-controller-2026-07-12.md`
for the failure families to expect.

**Release scheme + project identity (THINK-287):** the `release` verb's tags
and the worker prompts' project prose are config, not code:

```jsonc
"release": {
  "tagTemplate": "v0.1.0-canary.<N>",                    // <N> = next release number
  "extraTagTemplates": ["desktop-v0.1.0-canary.<N>"],    // minted alongside, same N
  "note": "The desktop tag deploys apps/web to dev."     // appended to the cut ack
},
"project": {
  "name": "ThinkWork",            // <PROJECT_NAME> in worker prompts
  "operatorName": "Eric",         // <OPERATOR_NAME> (prose)
  "operatorLinearHandle": "eric1" // <OPERATOR_HANDLE> (@mention in blocker comments)
}
```

Both sections are optional; omitting them preserves the values above.

---

## Operating the daemon

All commands run from `packages/factory`. `factoryd` below == `node_modules/.bin/tsx src/cli.ts`.

### CLI commands

| Command                       | What it does                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `factoryd run`                | Start the poll loop in the foreground (single dispatch authority).           |
| `factoryd run --once`         | Run exactly one tick and exit (tracer mode).                                 |
| `factoryd run --issue <ids…>` | Restrict a run to specific issue identifiers; skip every other candidate.    |
| `factoryd doctor`             | Check prerequisites: config, store, Linear API, `claude` bin, `gh` auth, bootstrap script. |
| `factoryd status`             | Show daemon/pipeline status (R18) from the operational store.                |
| `factoryd install`            | Render + bootstrap the daemon + watchdog LaunchAgents; warn on reboot preconditions. |
| `factoryd uninstall`          | Bootout both LaunchAgents and remove the plists.                             |
| `factoryd watchdog`           | One heartbeat-age check; posts a Slack webhook alert when overdue (the launchd interval job). |
| `factoryd pause` / `resume` / `halt` | **Not yet implemented** — use `launchctl bootout` to stop.            |

`install` flags: `--watchdog-interval <seconds>` (heartbeat-check cadence),
`--working-dir <path>` (daemon working directory; defaults to the package root).

### launchd lifecycle

The daemon installs as **two** LaunchAgents in `~/Library/LaunchAgents/`:

- `com.thinkwork.factory` — the daemon (`RunAtLoad` + `KeepAlive`, so it starts
  on load and auto-restarts on crash).
- `com.thinkwork.factory-watchdog` — an independent interval job that alerts
  (Slack webhook) when the daemon's heartbeat goes stale.

```bash
UID=$(id -u)

# Start / load (install does this for you; use after a manual bootout)
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.thinkwork.factory.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.thinkwork.factory-watchdog.plist

# Force an immediate (re)start — e.g. after deploying new code
launchctl kickstart -k gui/$UID/com.thinkwork.factory

# Stop / unload
launchctl bootout gui/$UID/com.thinkwork.factory
launchctl bootout gui/$UID/com.thinkwork.factory-watchdog

# Is it up?
launchctl list | grep factory        # a numeric pid in col 1 = running
```

> launchd never sources a shell rc, so it has **no PATH and no notion of
> `node`**. The plists are templates (`launchd/*.plist`) with
> `__DOUBLE_UNDERSCORE__` placeholders that `install` renders to **absolute**
> paths (node bin, entry script, working dir, explicit PATH). A bare `node` or a
> home-relative path is the #1 LaunchAgent failure — always install via the CLI.

### Deploying an update

The daemon runs from source via `tsx`, so a deploy is just **pull + restart** —
no build:

```bash
git -C <repoPath> pull --ff-only origin main
launchctl kickstart -k gui/$(id -u)/com.thinkwork.factory
```

`<repoPath>` is the `hosts[].repoPath` from config (the checkout the daemon runs
against). Reinstall (`factoryd install`) only when the plist template itself
changed.

---

## Logs & troubleshooting

- **Logs**: `~/.thinkwork-factory/logs/daemon.log` (stdout+stderr, structured
  JSON lines). `tail -f` it, or filter with `jq`:
  ```bash
  tail -f ~/.thinkwork-factory/logs/daemon.log \
    | node -e "process.stdin.on('data',b=>b.toString().trim().split('\n').forEach(l=>{try{const j=JSON.parse(l);console.log(j.ts,j.msg,j.issue||'',j.kind||'')}catch{}}))"
  ```
- **Store**: `~/.thinkwork-factory/factory.db` (sqlite). `factoryd status` reads it.
- **Worktrees**: `~/.thinkwork-factory/worktrees/`. `git -C <repoPath> worktree list`
  shows live worker worktrees (`auto-<issue>-<phase>-<attempt>`).

| Symptom | Check |
| --- | --- |
| Daemon won't stay up | `launchctl list \| grep factory` (col 2 = last exit code); the `daemon.log` tail for a `ConfigError`. Run `factoryd doctor`. |
| "config file not found / invalid" | `~/.thinkwork-factory/config.json` exists, is valid JSON, has `linear.apiKey`/`teamKey` and at least one host. |
| Workers never spawn | `claude`/`codex`/`gh` absolute paths + auth; the host's `capabilities` include the lane; `maxConcurrent` not saturated. |
| Nothing enrolls | Issue has a lane label **and** is at/above `Brainstorming` (Todo is ignored; Done is terminal). |
| `Rate limit exceeded` in `daemon.log` | The Linear key hit its 2,500 req/hr window. The daemon backs off 15 min per rate-limited tick and recovers on its own; if it recurs at idle, raise `pollIntervalSeconds`. |
| Slack silent | `slack.botToken`+`appToken`+`channelId` set; bot invited to the channel; `operatorUserIds` non-empty for the answer round-trip. |
| A live worker died on daemon restart | Detached workers survive a daemon restart by design; the reconciler re-adopts them. |

---

## Answering the factory in Slack

When a worker hits a blocking question it posts a numbered question (with a
recommended answer), adds `Needs User`, and stops. The daemon mirrors that into
the issue's Slack thread as an @mention. **Reply in that thread** — if your
Slack user id is in `operatorUserIds`, the answer is injected verbatim into the
worker's relaunch baton, `Needs User` is cleared, and the issue resumes. Replies
from anyone not on the allowlist are acknowledged but not injected. A bare
`status` in a thread returns that issue's current pipeline state.

### Answer forms in Slack

Escalations arrive as clickable **Block Kit forms**, not just text. When the
worker's `blocker:` comment carries a machine-readable fence of language
`answers` (the worker prompt mandates one), each question renders as a row of
option buttons — the recommended option is highlighted (`✅`, primary style).
One click relays that option exactly as if you had typed it (baton append,
`Needs User` cleared, Linear mirror), and the message's buttons are replaced
with an "✅ Answered by …" summary so the form can't double-fire. Escalations
with no parseable form (e.g. a daemon attempt-ceiling block) instead get a
`🔁 Clear blocker & retry` button plus the same escape hatch. `✍️ Other…`
never relays anything — it just reminds you to type your real answer in the
thread, which is relayed verbatim as before. Clicks from users not in
`operatorUserIds` are politely refused, exactly like typed replies.

The fence contract (appended after the prose in the same blocker comment; the
1-based `recommended` index is required, 2–4 options of ≤ 75 chars each):

````markdown
```answers
- question: Which OAuth scope should the connector request?
  recommended: 1
  options:
    - Read-only (drive.readonly)
    - Full drive access
```
````

One-time Slack app setup: enable **Interactivity & Shortcuts** in the app
configuration. No Request URL is needed — Socket Mode delivers the
`block_actions` payloads over the daemon's existing WebSocket. With
Interactivity off, buttons render but clicks silently go nowhere.

---

## Layout

```
packages/factory/
  src/
    cli.ts              # factoryd entrypoint (commander)
    daemon.ts           # poll loop, tick orchestration, shutdown contract
    config.ts           # config schema, load/validate, DEFAULT_PHASES
    domain/statuses.ts  # canonical vocabulary (ACTIVE_STATES, lanes, blockers)
    linear/             # Linear client, poller (enrollment filter), ledger, preflight
    phases/             # engine (routeByStatus / decideAction), executor, prompts
    workers/            # worker harness, attempt state machine, host transport
    slack/              # sync (threads + escalation + relay), client, status
    reconcile/          # daemon-death reconciler, un-enroll pass
    store/db.ts         # sqlite operational store
    cli-install.ts      # launchd render + bootstrap
    heartbeat.ts, watchdog.ts, logger.ts
  launchd/              # plist templates (rendered by `install`)
  scripts/worker-bootstrap.sh   # per-worker worktree bootstrap
  __tests__/            # vitest suites
  config.example.json
  REVIEW-DEFERRALS.md   # code-review findings deferred to later units
```

Design/spec (a planning artifact, not an operator guide):
`docs/plans/2026-07-12-001-feat-factory-daemon-plan.md`.

---

## Development

```bash
pnpm --filter @thinkwork/factory test         # vitest
pnpm --filter @thinkwork/factory typecheck    # tsc --noEmit
npx vitest run path/to/file.test.ts           # a single suite (from the package dir)
```

Tests point `THINKWORK_FACTORY_DIR` at a tmpdir and use fakes for Linear/Slack/
transport — no live services required.
