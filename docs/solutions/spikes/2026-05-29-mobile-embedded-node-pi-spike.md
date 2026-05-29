---
date: 2026-05-29
type: spike
topic: mobile-embedded-node-pi
status: complete
verdict: NO-GO (as specified) — redirect to social-principle fallback
plan: docs/plans/2026-05-29-002-feat-mobile-on-device-pi-embedded-node-plan.md
origin: docs/brainstorms/2026-05-29-mobile-on-device-pi-embedded-node-requirements.md
---

# Spike: Mobile on-device Pi via embedded Node (U1 go/no-go)

## Verdict

**NO-GO** for the bet as specified — "run the same `pi-runtime-core` /
`@earendil-works/pi-coding-agent` core on-device in `nodejs-mobile`." Two independent
hard walls were found by **desk research alone**, before any native build or TestFlight
artifact was needed. Both were vindicated by reading the installed framework
(`@earendil-works/*@0.76.0`, present in `.claude/worktrees/spaces-settings/` and
`.Codex/worktrees/local-pi-validation/`), not by guessing.

The spike did its job: it killed the expensive path (native iOS build, signing,
TestFlight, device measurement) before any of it was started.

## Go/No-Go criteria — results

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| a | Bedrock turn from the Node host on a TestFlight build | **Not reached** — moot | Blocked by (c)/(d); no point building an artifact that can't load the framework |
| b | Custom SigV4 Bedrock transport replaces the AWS SDK via the `005` `ModelProvider` seam | **Not reached** — moot | Same; the seam question is irrelevant if the framework can't load |
| c | Native `.node` addons in the framework dependency tree | **FAIL** | `@earendil-works/pi-tui` (direct dep of `pi-coding-agent`, 192 refs in its `dist`) ships a `.node` addon; tree also pulls `better-sqlite3`, `@mariozechner/clipboard-*`, `@napi-rs/canvas`. iOS forbids dynamic linking of `.node` addons |
| d | Core + framework run on the embedder's Node | **FAIL** | All four pi packages (`pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui`) declare `engines.node: ">=22.19.0"`. `nodejs-mobile` ships **Node 18** (v18.20.4, Oct 2024); Node 18 is **EOL (Apr 2025)**. No Node-22 jitless iOS build exists |
| e | App-size + cold-start budget | **Not measured** — moot | Blocked by (c)/(d) |
| f | Is shipping on EOL Node 18 an acceptable posture | **N/A** | Doesn't arise — the framework can't run on 18 regardless; it requires ≥22.19 |

## Findings in detail

### Wall 1 — the framework requires Node ≥22.19; iOS embedded Node is stuck at 18

Read directly from the installed packages:

- `@earendil-works/pi-coding-agent@0.76.0` → `engines.node: ">=22.19.0"`
- `@earendil-works/pi-agent-core@0.76.0` → `engines.node: ">=22.19.0"`
- `@earendil-works/pi-ai@0.76.0` → `engines.node: ">=22.19.0"`
- `@earendil-works/pi-tui@0.76.0` → `engines.node: ">=22.19.0"`

`pi-agent-core` and `pi-ai` are the loop and model layers — they cannot be avoided by
any embedding strategy. The only maintained tool that embeds Node on iOS,
`nodejs-mobile`, ships **Node 18** and has shipped no Node 20/22 build (volunteer
maintenance, last release Oct 2024). NodeKit and Node.app are ES5/"compat" shims, not
real modern Node. Producing a Node-22 jitless iOS framework ourselves is a major,
ongoing build/maintenance undertaking — it is the entire reason `nodejs-mobile` exists.

This wall is independent of native addons: even a pure-JS framework requiring ≥22.19
could not run on the Node-18 embedder.

### Wall 2 — the framework directly depends on a native addon

- `@earendil-works/pi-tui` ships a `.node` binary and is a **direct** dependency of
  `pi-coding-agent`, referenced **192×** in `pi-coding-agent/dist`. The SDK entry
  (`createAgentSession`, exported from `dist/main.js`) is part of the same package, so
  `import("@earendil-works/pi-coding-agent")` pulls `pi-tui` — and its `.node` — at
  load.
- The wider tree also contains `better-sqlite3`, `@mariozechner/clipboard-*`,
  `@napi-rs/canvas`, and `sharp` native addons. (`better-sqlite3` is **not** referenced
  in `pi-coding-agent/dist` — 0 hits — so session storage at the coding-agent layer is
  likely injectable; but `pi-tui` alone is disqualifying.)
- iOS does not allow dynamic linking of third-party `.node` addons. Removing `pi-tui`
  would mean forking/patching the framework — contradicting the plan's core principle
  ("one core, no host reimplements/forks the loop").

Note: `pi-agent-core` and `pi-ai` themselves declare **no** native-ish direct deps. A
*much narrower* embed at the `pi-agent-core` layer (below `pi-coding-agent`/`pi-tui`)
might sidestep Wall 2 — but it still hits Wall 1 (≥22.19), and it abandons the
`createAgentSession` SDK surface that `005` and the desktop host standardize on.

## What this means for the plan

The plan's premise — "the phone runs the *same* core as cloud/desktop via embedded
Node" — is **not achievable today**. To make it work you would need *both*:

1. A Node ≥22.19 jitless iOS runtime (does not exist; we would have to build and
   maintain it), **and**
2. The framework embeddable without any native addon on the load path (today requires
   forking out `pi-tui`).

That is a far larger, more speculative program than the plan scoped, and it directly
fights the "single core, no fork" principle. The user's Node-version skepticism was
the correct thread to pull.

## Recommendation

**Redirect to the brainstorm's "social-principle" fallback** (origin Option B): the
phone drives the user's *personal* Pi — the desktop sidecar when reachable, else a
personal cloud Pi — over the app's existing device-authenticated Gateway WS transport,
delegating heavy work to managed AgentCore. This delivers "your agent, always with
you" as **ownership/identity** rather than literal on-device silicon, with no embedded
runtime, no Node-version wall, no native-addon wall, and ships on plain Expo. It reuses
`useGatewayChat` + the Ed25519 device identity that already exist.

The embedded-Node path is **not permanently foreclosed**, but it is gated on external
events outside our control. Revisit only if **both** flip:

- A maintained Node ≥22.19 jitless iOS embedder ships (watch `nodejs-mobile` releases),
  **and**
- `@earendil-works/pi-coding-agent` becomes embeddable with no native addon on the
  `createAgentSession` load path (i.e., `pi-tui` is no longer a hard import dependency
  of the SDK surface), or the platform standardizes on embedding at the
  `pi-agent-core` layer.

A cheaper near-term experiment, if the principle still itches: prototype the
**social-principle** path (phone → personal/desktop Pi over the relay) — that is
buildable now and is the honest way to make the phone feel like a first-class surface.

## Method / reproducibility

All findings are from reading the installed framework, no device required:

```
STORE=.claude/worktrees/spaces-settings/node_modules/.pnpm
# engines for each @earendil-works/* package's package.json → all ">=22.19.0"
# native .node scan of the store → pi-tui ships .node; better-sqlite3/clipboard/canvas/sharp present
# grep pi-coding-agent/dist for 'pi-tui' → 192 refs; for 'better-sqlite3' → 0 refs
```

(`nodejs-mobile` Node-18 ceiling, Node-18 EOL Apr 2025, and the absence of a Node-20/22
iOS jitless build are from the plan's external research; see plan Sources & Research.)

## Status

U1 complete. Plan `docs/plans/2026-05-29-002-...` should move to `status: blocked`
(pending the two external flips above) or be superseded by a social-principle
brainstorm/plan. Device/TestFlight criteria (a, b, e) were never exercised and need not
be — they are downstream of walls that hold today.
