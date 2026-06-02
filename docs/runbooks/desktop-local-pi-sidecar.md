# Desktop Local Pi Sidecar

The desktop local Pi sidecar lets the Electron shell orchestrate a Pi turn on
the user's machine while still using backend-prepared Bedrock, Hindsight,
rendered workspace, finalizer, and managed-delegation contracts.

## Rollout Gate

Local Pi is disabled by default for every desktop build. Enable it explicitly
for focused investigation with:

```bash
VITE_DESKTOP_LOCAL_PI_ENABLED=true
```

You can also pin the disabled state explicitly with:

```bash
VITE_DESKTOP_LOCAL_PI_ENABLED=false
```

When disabled, the Electron Pi bridge returns an unavailable status and the
Spaces renderer keeps using managed AgentCore dispatch. The renderer must not
receive credentials, cache paths, or raw process diagnostics in either mode.

## Smoke Checklist

1. Build a dev package:

   ```bash
   DESKTOP_SKIP_TERRAFORM=1 BUILD_CHANNEL=dev VITE_DESKTOP_LOCAL_PI_ENABLED=true \
     bash scripts/build-desktop.sh dev --dir --publish never
   ```

2. Launch the packaged app, sign in, and open an agent-backed Space thread.
3. Send one message that can be answered from the rendered app workspace.
4. Confirm the header shows `Pi local` before sending and `Pi running` while
   the turn is active.
5. Confirm the assistant response finalizes normally and the turn records
   `runtime_host: "desktop-local"`.
6. Ask for a consequential delegated task and confirm visible managed
   delegation renders as a normal Thinking/activity row.
7. Kill or disable the sidecar, send another message, and confirm the UI does
   not mark the send as desktop-local; managed fallback should handle the turn.
8. Repeat with `VITE_DESKTOP_LOCAL_PI_ENABLED=false` and confirm no sidecar is
   started and sends stay on the managed path.

## Diagnostics

Desktop writes local Pi diagnostics under the app-owned user data directory:

```text
pi-diagnostics/pi-sidecar.log
```

The log is bounded and redacted before write. It may include lifecycle state,
runtime version, app version, stage, host type, restart count, exit code,
hashed tenant/agent scope, and delegation decisions.

The log must not include:

- AWS access keys, secret keys, session tokens, or signed S3 query material
- Hindsight, OAuth, or finalizer tokens
- Raw tenant, user, agent, Space, or workspace identifiers
- User message bodies or prompt content
- Renderer-accessible filesystem cache paths

If a diagnostic is needed in the renderer, expose only summarized status over
typed IPC. Keep raw logs owned by the desktop main process.

## Known Fallback Behavior

- Sidecar disabled: Pi status is unavailable; sends use managed AgentCore.
- Sidecar startup failure: the header can show cloud fallback, and future sends
  avoid desktop-local dispatch until the sidecar recovers.
- Local turn failure after message persistence: the message remains saved; the
  user can retry or run the next turn through managed fallback.
- Hidden managed delegation: no extra UI chrome; evidence should be included in
  the final assistant response when relevant.
- Visible managed delegation: render in the existing thread activity surface.
