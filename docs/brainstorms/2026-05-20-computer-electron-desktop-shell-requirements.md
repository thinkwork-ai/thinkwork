---
date: 2026-05-20
topic: computer-electron-desktop-shell
---

# ThinkWork Computer — Electron Desktop Shell

## Summary

Wrap `apps/computer` (the end-user React 19 + Vite SPA) in an Electron desktop shell, shipping signed/notarized macOS and Windows installers with an autoupdater, a hardened security baseline, and native menu/window chrome. The shell behaves like Slack or Notion desktop — an installed windowed app, not a system-resident agent — and adopts t3code's main-process patterns (custom `thinkwork://` protocol, typed `contextBridge` over Zod-validated IPC, `safeStorage`-backed Cognito token vault, pure-reducer update state machine, two-phase startup) implemented in plain TypeScript.

---

## Problem Frame

`apps/computer` today is a browser-tab product. End users open the SPA in Chrome or Safari, sign in via Cognito Google OAuth, and interact with their agents and generated applets through urql + AppSync. The product works in the browser, but the framing limits how users perceive and adopt it.

Three pressures motivate the desktop conversion:

1. **Install identity.** A bookmark in a browser tab is not a product. Slack, Notion, Linear, Cursor, and Claude Desktop are all available in the browser, yet each ships a desktop app because users treat installed software as more substantial, more trustworthy, and more central to their workflow than a tab.
2. **Stable launch surface.** Browser tabs get closed, lost in tab groups, or evicted from memory. A dock icon and a `⌘Tab` slot create a predictable home for the product that survives the user's browsing habits.
3. **Distribution control.** Signed installers, an autoupdater, and stage-specific build identities give the product the same delivery surface as every other desktop app the user runs — and let the team ship updates without users needing to refresh a tab or clear caches.

Today's gap: the React SPA is mature, but it runs only inside a browser context the team does not control. The desktop shell exists to give the same SPA a controlled host that adds install identity and update delivery without rewriting product behavior.

---

## Key Flows

- F1. First-launch sign-in via Cognito Google OAuth deep link
  - **Trigger:** User installs the desktop app and launches it for the first time
  - **Actors:** End user, Cognito hosted UI, Google OAuth, the desktop app
  - **Steps:**
    1. App launches, detects no cached refresh token, presents a "Sign in with Google" affordance.
    2. User clicks sign-in. Renderer asks the main process to open the Cognito hosted-UI URL via `shell.openExternal` in the system browser.
    3. User completes Google OAuth in the system browser. Cognito redirects to `thinkwork://oauth/callback?code=...`.
    4. OS routes the custom-scheme URL back to the desktop app: `open-url` event on macOS, second-instance argv on Windows.
    5. Main process parses the callback, exchanges the code for tokens via Cognito, stores the refresh token in OS keychain via `safeStorage`, surfaces a session-established event to the renderer.
    6. Renderer hydrates session state and routes to the post-login destination.
  - **Outcome:** User is signed in; refresh token persisted in OS keychain; subsequent launches skip OAuth.
  - **Failure path:** If `safeStorage` is unavailable (Linux without libsecret, hypothetical future scope), tokens are held in-memory only for the session and the user must re-authenticate on next launch — flagged in the UI.
  - **Covered by:** R6, R7, R8, R9

- F2. Returning-user cold launch with cached session
  - **Trigger:** User launches the desktop app after a prior successful sign-in
  - **Actors:** End user, the desktop app, Cognito token endpoint
  - **Steps:**
    1. Main process starts, loads cached refresh token from OS keychain via `safeStorage`.
    2. Refresh token exchanged for fresh access + ID tokens against Cognito.
    3. Main process registers IPC handlers, creates the main window with `show: false`, loads the SPA via `thinkwork://app/`.
    4. Renderer mounts, requests session bootstrap via IPC, receives tokens, configures urql + AppSync.
    5. Window reveals on `ready-to-show` event with theme-matched background color — no white flash.
  - **Outcome:** User sees the signed-in app within seconds of launch; no OAuth round trip required.
  - **Failure path:** If the refresh token is expired or revoked, the app falls back to F1 with the failure surfaced inline.
  - **Covered by:** R7, R8, R10, R15

- F3. Autoupdate check, download, install
  - **Trigger:** App starts, or user picks "Check for Updates" from the menu
  - **Actors:** End user, the desktop app, the update feed
  - **Steps:**
    1. Update state machine transitions from `disabled` → `checking`.
    2. `electron-updater` polls the update feed for the configured channel.
    3. If an update is available, state transitions to `available`; renderer shows a non-blocking banner.
    4. User accepts; state transitions to `downloading`, progress events stream to the renderer.
    5. On completion, state transitions to `downloaded`; renderer shows "Restart to install."
    6. User restarts; `electron-updater` installs and relaunches the app.
  - **Outcome:** App is on the latest version without user intervention beyond a single restart.
  - **Failure path:** Download or install failure transitions to `error` with `canRetry: true`; renderer surfaces the failure and lets the user retry without reinstalling from scratch.
  - **Covered by:** R11, R12, R13

---

## Requirements

**Packaging and distribution**
- R1. macOS launches first as a notarized `.dmg` (arm64 + x64, ideally universal). Windows ships as a signed `.exe` installer (x64 minimum; arm64 if feasible) once a Windows code signing certificate is procured and the signing pipeline is in place — same codebase, post-launch.
- R2. Build identity differs per stage. Dev/canary builds carry a distinct `productName` (e.g., `ThinkWork Computer (Dev)`), distinct dock/start-menu icons, and a distinct `userData` directory so they coexist with production installs without colliding state.
- R3. An autoupdater ships with the app, configured against GitHub Releases as the update feed (the canonical `electron-updater` integration). CI publishes signed/notarized artifacts plus `latest-mac.yml` / `latest.yml` manifests to a Releases endpoint per channel. Update channels include at minimum `stable`; a `canary` or `nightly` channel is supported by configuration even if not enabled at launch.

**Security baseline**
- R4. Every `BrowserWindow` is created with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a preload script — no exceptions.
- R5. The renderer cannot open new windows via `window.open`, navigate to arbitrary URLs, or spoof the window title. External links open in the system browser via `shell.openExternal` after passing a URL allowlist parser. `page-title-updated` is intercepted so the renderer cannot rewrite the OS-level window title.

**Renderer load and protocol**
- R6. In production builds, the renderer loads via a custom `thinkwork://` protocol registered as `standard: true, secure: true, supportFetchAPI: true, corsEnabled: true`. The handler serves the built Vite bundle from disk with path normalization that rejects `..` traversal segments and falls back to `index.html` for unmatched SPA routes.
- R7. The `thinkwork://` scheme is registered as the default protocol client via `app.setAsDefaultProtocolClient`, with handlers for `open-url` (macOS) and `second-instance` (Windows) to capture OAuth callback URLs and route them into the main process.

**Auth and session**
- R8. Cognito Google OAuth runs in the system browser, not embedded WebView. The callback returns to the app via the `thinkwork://oauth/callback` deep link.
- R9. The Cognito refresh token is stored in the OS keychain via `Electron.safeStorage` (Keychain on macOS, DPAPI on Windows) — never in localStorage or plaintext on disk. A `safeStorage` availability check runs at startup; if encryption is unavailable, the app falls back to in-memory session and surfaces the degraded mode.
- R10. The renderer obtains session tokens from the main process via the typed IPC bridge, not by directly reading storage. This keeps the renderer sandboxed and lets the main process refresh tokens on a schedule without renderer involvement.

**Window, chrome, and UX polish**
- R11. The main window uses a modern chrome treatment: `titleBarStyle: "hiddenInset"` with custom `trafficLightPosition` on macOS; `titleBarOverlay` with theme-aware colors on Windows. The chrome respects the system dark/light setting.
- R12. The window is created with `show: false`, a background color matching the current theme, and revealed on `ready-to-show` — no white flash on launch.
- R13. A native application menu provides standard `File`, `Edit`, `View`, `Window`, `Help` entries plus a `Check for Updates` item that drives the update state machine. The menu respects platform conventions (App menu on macOS, no menu bar on Windows when not needed).

**IPC bridge**
- R14. The preload script exposes a single typed bridge object (`window.thinkworkBridge`) via `contextBridge.exposeInMainWorld`. The bridge interface lives in a shared package consumed by both preload and renderer; preload uses `satisfies` to ensure the surface matches the contract.
- R15. Every IPC channel has a constant identifier (no inline string literals on either side) and a Zod schema for payload and result. Handlers decode input and encode output through the schema at the IPC boundary so wire data is validated even though Electron's IPC is `unknown`-typed.

**Update state machine**
- R16. Update lifecycle is modeled as a typed state shape with status `disabled | checking | available | downloading | downloaded | up-to-date | error`. State transitions happen through pure reducer functions and are pushed to the renderer over a dedicated IPC channel.
- R17. The update state includes arch metadata (`hostArch`, `appArch`, `runningUnderArm64Translation`) so the renderer can surface "you're running an x64 build on Apple Silicon" guidance when relevant.

**Notifications**
- R18. The renderer-side `Notification` API delivers in-app notifications (e.g., agent completion) when the window is open or backgrounded. No main-process notification router; if the window is closed, the app is quit and notifications do not fire.

**iframe-shell artifact runtime**
- R19. The custom `thinkwork://` protocol handler sets a strict Content-Security-Policy header for renderer responses, lockable independently of the web app's CSP. The artifact iframe-shell inherits or further constrains this CSP — decided during planning.

**Developer experience**
- R20. The desktop app builds via `electron-vite`, reusing the existing `apps/computer` Vite config as the renderer build without modification. Main and preload are bundled separately (CommonJS or ESM per electron-vite default).
- R21. A dev launcher waits for both the Vite dev server (TCP probe) and the built main/preload bundles before spawning Electron, watches the bundles for changes with a debounced restart, distinguishes intentional restarts from crashes, and cleans up stale dev processes by marker arg.

---

## Acceptance Examples

- AE1. **Covers R5.** Given the user is on the chat page, when they click a link to `https://github.com/some-repo`, the link opens in the system default browser and no new Electron window opens.
- AE2. **Covers R6.** Given the user is on a deep SPA route `thinkwork://app/agents/abc-123` and reloads, the route resolves to `index.html` and the SPA router hydrates the deep route — no 404.
- AE3. **Covers R8, R9.** Given the user is signed in, when they fully quit the app and relaunch, the cached refresh token in OS keychain is used to restore session within ~2 seconds without opening the system browser for OAuth.
- AE4. **Covers R9.** Given `safeStorage.isEncryptionAvailable()` returns `false` at startup (degraded environment), when the user signs in, tokens are held in-memory only and the UI surfaces a "session will not persist across restarts" notice.
- AE5. **Covers R11, R12.** When the user launches the app, the window appears in the user's current theme (dark or light) with no white flash, and the macOS traffic lights are positioned inside the hidden-inset titlebar at the configured offset.
- AE6. **Covers R16.** When a new version is published to the update feed and the user picks "Check for Updates," the state machine transitions through `checking` → `available` → `downloading` → `downloaded` and the renderer reflects each transition without polling.
- AE7. **Covers R17.** Given the user is running an x64 desktop build on an Apple Silicon Mac (Rosetta), when the renderer reads update state, `runningUnderArm64Translation` is `true` and the UI prompts the user to download the arm64 build.
- AE8. **Covers R4, R15.** When the renderer attempts to send a message with a payload that fails Zod validation at the IPC boundary, the main-process handler rejects the message with a typed error and the renderer surfaces the validation failure — no silent corruption.

---

## Success Criteria

- A user can download an installer for their platform, complete OAuth sign-in once, and use ThinkWork Computer for everything the web app supports — chat, applets, memory, threads, approvals — with no functional gaps relative to the web version.
- The app autoupdates without user intervention beyond restart, and the update state is observable in the UI throughout the lifecycle.
- A security review can verify that the renderer process cannot access Node APIs, cannot read arbitrary files, cannot navigate to arbitrary URLs, and cannot bypass the IPC schema validation.
- `ce-plan` can read this document and produce a step-by-step implementation plan — covering electron-vite configuration, IPC bridge module structure, update feed hosting, code signing certificates, OAuth callback routing into TanStack Router, and CI artifact build — without needing additional product decisions.

---

## Scope Boundaries

- No system tray, no always-on background mode, no hide-to-tray-on-close behavior — closing the main window quits the app like Slack or Notion desktop.
- No global hotkeys (`globalShortcut`).
- No main-process notification router (notifications fire only when the renderer is alive).
- No local filesystem access as a primary product capability — file pickers, drag-and-drop, and folder watchers are not part of v1.
- No Linux build at launch — same codebase should be able to target it later, but no Linux installer, no libsecret fallback work, no AppImage/.deb in v1.
- No embedded local backend, no SSH-to-remote-agent, no Tailscale Serve, no per-host port scanning — ThinkWork's backend stays on AWS and the desktop app talks to it over the network like the web app does today.
- No consolidation of `apps/mobile` (Expo) onto the same shell. Tauri 2's mobile support made this tempting; explicitly out of scope for v1.
- No adoption of Effect, Bun, oxlint, or oxfmt to match t3code's toolchain. The desktop app stays on pnpm + Node + esbuild + ESLint + Prettier consistent with the rest of the monorepo.
- No Windows installer at launch — Windows ships post-launch once a code signing certificate is procured and the signing pipeline is set up. macOS-only launch avoids the SmartScreen "Unrecognized publisher" UX entirely.
- No self-hosted update infrastructure (S3 + CloudFront for update manifests). Updates go through GitHub Releases, which `electron-updater` supports natively with zero new AWS infra.

---

## Key Decisions

- **Electron over Tauri.** Webview consistency wins. WebView2 on Windows is Chromium; on macOS the iframe-shell artifact runtime would face Safari WebKit, which is a real divergence surface even though Mac web users already render in Safari today. Electron eliminates the divergence at the cost of a larger installer (~100–180MB vs Tauri's ~15–25MB). Bundle size is a real loss but predictable webview behavior is worth more for an artifact-rendering product.
- **Plain TypeScript + Zod over Effect.** t3code's main-process patterns (scoped lifecycle, typed services, schema-validated IPC, pure-reducer state machines) transfer directly. The Effect framework that hosts them in t3code does not — adopting Effect just for the desktop app would be a huge ongoing tax against a monorepo that uses none of it elsewhere. Borrow the shape, not the framework.
- **Custom `thinkwork://` protocol for prod renderer load.** `file://` cannot host Service Workers, cannot be marked secure, breaks fetch CORS, and exposes the user's filesystem path. A custom standard-secure scheme fixes all four and is also the natural home for the OAuth callback URL.
- **`safeStorage` for Cognito refresh token in desktop mode.** OS keychain (Keychain / DPAPI) is strictly better than the web app's localStorage fallback. Replaces `amazon-cognito-identity-js`'s default storage when running under Electron.
- **`electron-vite` as the build tool.** Reuses the existing `apps/computer` Vite config as the renderer build untouched, only adds main + preload bundling. Idiomatic 2026 choice that aligns with the existing Vite-native dev experience.
- **Windowed installed app, not system-resident.** Closing the window quits the app. No tray. No global hotkeys. No always-on background. Matches Slack and Notion desktop's posture, not Cursor or Claude Desktop's.
- **OAuth in system browser, not embedded WebView.** Aligns with Cognito's recommended desktop OAuth pattern, avoids embedded-WebView restrictions that Google has been progressively tightening, and keeps the user's existing Google session active.
- **macOS-first launch; Windows follows once signed.** Avoids the SmartScreen "Unrecognized publisher" warning entirely and lets the team validate the architecture on a single platform before adding Windows-specific complexity (DPAPI, second-instance argv parsing, NSIS installer signing). Windows ships on the same codebase when the cert lands.
- **GitHub Releases as the update feed.** Native `electron-updater` integration with zero new AWS infrastructure. Couples release distribution to a GitHub repo + CI token, which is acceptable since the desktop app's release artifacts are already public-installer-shaped (not customer data).

---

## Dependencies / Assumptions

- The `apps/computer` iframe-shell artifact runtime already executes in Safari WebKit when Mac users run the web app, so Chromium-equivalent rendering in Electron is a non-issue. Verified premise, not assumption.
- Cognito Google OAuth federation will accept `thinkwork://oauth/callback` as a CallbackURL on the existing `ThinkworkComputer` user pool client (or a new desktop-specific client). Adding the callback URL is a Cognito config change that lands before launch — assumption to verify with the auth/Cognito setup.
- Apple Developer Program membership exists under the Eric Individual team (per `project_mobile_testflight_setup` memory). Code signing + notarization for macOS uses this team's credentials.
- A Windows code signing certificate (OV or EV) is not yet procured. Windows ships post-launch; v1 launch is macOS-only.
- The GitHub repo hosting release artifacts is decided during planning (likely a dedicated repo so installer downloads do not depend on the main monorepo's visibility). CI gets a token (PAT or GitHub App) scoped to publish releases.
- The desktop app continues to use the same AWS backend (GraphQL HTTP + AppSync subscriptions + Cognito) as the web app and mobile app. No new backend infrastructure required.
- t3code's Apache/MIT-style license permits pattern adoption. Patterns are reimplemented in our own code; no direct code copy that would require attribution.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6, R7] [Technical] Exact routing of the `thinkwork://oauth/callback` deep link into the renderer's TanStack Router. Likely a main-process IPC event that the renderer subscribes to via a `useEffect` on mount, but the timing relative to TanStack Router's initialization needs verification during planning.
- [Affects R15] [Technical] Whether to share existing Zod schemas from `packages/api` for IPC payloads or define desktop-specific schemas. Affects coupling between desktop and API.
- [Affects R19] [Needs research] Whether the artifact iframe-shell can adopt a stricter CSP than the web app without breaking shadcn/Radix components, streamdown, mermaid, or Leaflet. Likely requires a small spike during planning.
- [Affects R20, R21] [Technical] Exact `electron-vite` configuration split — main vs preload vs renderer entry points, how the renderer config inherits from `apps/computer/vite.config.ts`, and how `vite.iframe-shell.config.ts` participates.
- [Affects R3, R16] [Technical] Update channel strategy under GitHub Releases: does each channel (stable, canary) map to a separate GitHub repo, separate release tags within one repo, or a pre-release flag? Affects how `productName` per stage (R2) maps to autoupdater configuration.
- [Affects R3] [Technical] Which GitHub repo hosts release artifacts — the main `thinkwork` monorepo or a dedicated public release repo? Visibility, CI token scope, and download-URL stability all hinge on this.
- [Affects all] [Technical] Pre-spike: a one-week deep-link OAuth callback validation before committing the full build. Every desktop OAuth implementation finds an edge case at the `open-url` boundary on macOS; the spike de-risks the rest of the work.
