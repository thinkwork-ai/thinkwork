---
title: feat — Electron desktop shell for apps/spaces
type: feat
status: active
date: 2026-05-21
deepened: 2026-05-21
origin: docs/brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md
---

# feat: Electron desktop shell for apps/spaces

## Summary

Add `apps/desktop/` — a new Electron 42 + electron-vite 5 wrapper around the existing `apps/spaces` React 19 + Vite SPA — and ship signed/notarized macOS DMG installers with `electron-updater` against GitHub Releases. The renderer build stays untouched (electron-vite delegates to `apps/spaces/vite.config.ts`). Cognito auth is hoisted into the main process behind a new pluggable `TokenStorage` interface so the desktop variant routes through the IPC bridge into `Electron.safeStorage` while the web variant continues using `localStorage`. The plan is sequenced as: OAuth cold-start spike → foundation → auth flow → update + native UX → build + release → docs.

---

## Problem Frame

`apps/spaces` runs only as a browser tab today. The brainstorm establishes the install-identity, stable-launch-surface, and distribution-control motivations (see origin doc Problem Frame). This plan addresses the *how*: a new `apps/desktop/` package, a refactor of `apps/spaces/src/lib/auth.ts` to enable per-platform token storage, two adjacent Terraform changes (Cognito callback URLs + iframe-shell parent-origin allowlist), and a new macOS GitHub Actions release pipeline that doesn't exist anywhere in the repo today.

---

## Requirements

This plan inherits all 21 requirements from the origin brainstorm (see [docs/brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md](../brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md)) and adds three plan-time requirements surfaced by research.

**Brainstorm requirements carried forward** (R1–R21 per origin)
- R1–R3 Packaging and distribution: macOS-first launch, stage-specific build identity, GitHub Releases autoupdater.
- R4–R5 Security baseline: contextIsolation/sandbox/nodeIntegration/preload on every window, no `window.open`, external-link allowlist, no title spoofing.
- R6–R7 Renderer load and protocol: custom `thinkwork://` scheme registered as standard+secure+supportFetchAPI+corsEnabled with traversal-safe path resolution and SPA fallback; default protocol client for OAuth callbacks.
- R8–R10 Auth and session: Cognito OAuth via system browser; refresh token in OS keychain via `safeStorage`; tokens delivered to renderer via typed IPC, not direct storage reads.
- R11–R13 Window, chrome, UX polish: hidden-inset titlebar, theme-matched ready-to-show reveal, native application menu.
- R14–R15 IPC bridge: typed `contextBridge` surface from a shared contracts package; channel constants; Zod-validated payloads.
- R16–R17 Update state machine: typed status enum with pure reducers; arch metadata for Rosetta detection.
- R18 Renderer-side notifications only.
- R19 iframe-shell CSP upgrade via custom protocol handler.
- R20–R21 Dev experience: `electron-vite` reusing existing Vite config; debounced dev launcher with TCP wait.

**Plan-time additions**
- R22. **PKCE S256 + state nonce on the OAuth flow.** RFC 9700 (Jan 2025) made PKCE MUST for all OAuth clients including public desktop clients. Cognito app client must be configured without a client secret. Code verifier is generated per attempt in main, kept in memory only, deleted after the token exchange; state nonce is generated with `crypto.randomBytes` and validated on callback (reject mismatch).
- R23. **Cognito refresh-token rotation enabled on the user-pool client.** RFC 9700 §4.3.3 makes rotation MUST for public clients. Each `refreshSession` call issues a new refresh token; the old one is invalidated by Cognito's replay detection.
- R24. **TokenStorage abstraction in `apps/spaces/src/lib/auth.ts`.** The current direct `localStorage` reads/writes (8 call sites) become calls into a small `TokenStorage` interface. Web variant constructs the localStorage-backed implementation; desktop variant constructs the IPC-backed implementation that proxies into main-process `safeStorage`. Required because `amazon-cognito-identity-js`'s `Storage` API is sync-only and a sync-IPC bridge would be an anti-pattern.

**Origin actors:** A1 End-user operator (single actor; no operator/admin split inside the desktop shell).
**Origin flows:** F1 First-launch OAuth, F2 Returning-user cold launch with cached session, F3 Autoupdate check/download/install.
**Origin acceptance examples:** AE1 (R5), AE2 (R6), AE3 (R8/R9), AE4 (R9), AE5 (R11/R12), AE6 (R16), AE7 (R17), AE8 (R4/R15).

---

## Scope Boundaries

Carried verbatim from the origin brainstorm (see origin Scope Boundaries — all eight bullets stand). Repeated here for the items most likely to come up during implementation:

- No system tray, no always-on background, no global hotkeys, no main-process notification router. Closing the window quits.
- No local filesystem access as a primary product capability in v1.
- No Linux installer at launch.
- No embedded local backend, no SSH-to-remote-agent, no Tailscale Serve.
- No consolidation of `apps/mobile` (Expo) onto the same shell.
- No adoption of Effect, Bun, oxlint, or oxfmt to match t3code's toolchain.
- No Windows installer at launch — Windows ships post-launch once a code signing certificate is procured.
- No self-hosted update infrastructure (S3 + CloudFront). Updates go through GitHub Releases.

### Deferred to Follow-Up Work

- **Manifest signing (Doyensec SafeUpdater pattern):** Ed25519-signed `latest-mac.yml` verified by a public key compiled into the app. Defers to v1.1 hardening. Accepts the supply-chain risk at launch that a compromised GitHub Releases publish token could push a malicious update. Mitigations at v1: OIDC-bound publish token (no long-lived PAT), quarterly token rotation.
- **Windows installer + signing pipeline:** ship when a Windows code signing certificate (OV or EV) is procured. Code path stays platform-neutral so the second release is a CI-only addition, not a rewrite.
- **Differential / block-map updates:** skip in v1; revisit only if installer size grows past ~250MB or user reports of update bandwidth on slow connections surface. Modest savings on Electron-framework-heavy apps don't justify the added complexity.
- **AppSync subscription longevity over long-lived desktop sessions** (laptop sleep, network flap, in-flight token refresh): no characterization exists in `docs/solutions/`; mobile sessions get aggressive iOS backgrounding that masks the issue. Worth a follow-up brainstorm pre-launch but not in this plan's scope.
- **Raise `ThinkworkAdmin` refresh-token validity from 30d to 90d:** keep at 30d for v1; raise if friction reports come in. Avoids a Cognito-client config change that affects web users too.
- **New `docs/solutions/` runbook entries** that capture the Cognito callback-URL update playbook and the Apple credentials rotation playbook. Author after the first real instance, per repo convention.
- **Rename Terraform `computer_*` → `spaces_*` (Registry breaking change).** ~30 `computer_*` identifiers across 11 Terraform files (variables, outputs, the `terraform/modules/app/computer-runtime/` module, the `terraform/examples/greenfield/` reference deploy). Plus the workspace packages `packages/computer-stdlib` and `packages/computer-runtime`. This is a `thinkwork-ai/thinkwork/aws` Terraform Registry breaking change with a customer-migration story (`terraform.tfvars` updates, `moved {}` blocks for resource addresses, state-migration runbook, CLI release ordering — same shape as the static-site artifact-name change in `dfc43c0d` but with a much larger blast radius). Deferred to its own brainstorm/plan; this plan's only Terraform contact is additive extension of `var.computer_sandbox_allowed_parent_origins` and the `ThinkworkAdmin` callback URL list.

---

## Context & Research

### Relevant Code and Patterns

- `apps/spaces/package.json`, `apps/spaces/vite.config.ts`, `apps/spaces/vite.iframe-shell.config.ts` — renderer build configuration the desktop shell delegates to. `vite.config.ts` is dev-port-pinned to 5174 with `strictPort: true` and polyfills `global: "globalThis"` for `amazon-cognito-identity-js`. Do not modify.
- `apps/spaces/src/main.tsx` — React entry. Provider tree (`ThemeProvider` → `UrqlProvider` → `AuthProvider` → `TenantProvider` → `PageHeaderProvider` → `TooltipProvider` → `RouterProvider`) wraps the SPA. The desktop variant detects Electron context here and chooses the IPC-backed TokenStorage.
- `apps/spaces/src/lib/auth.ts` — 367-line Cognito wrapper with 8+ direct `localStorage` calls keyed on `CognitoIdentityServiceProvider.<CLIENT_ID>.<user>.*`. This file is refactored by U6 to take a `TokenStorage` interface; web and desktop construct different implementations.
- `apps/spaces/src/routes/auth/callback.tsx` — existing TanStack Router OAuth callback for the web flow; uses `validateSearch` for `{code, error, error_description}`, idempotent exchange (the `exchanged` ref guards React Strict Mode double-fire), and full-page redirect after token write. U9 follows this pattern for the desktop variant.
- `apps/spaces/src/routes/_authed.tsx` — auth gate using `beforeLoad` redirect to `/sign-in?next=<path>`. Pattern reused for desktop deep-link routing.
- `terraform/modules/foundation/cognito/main.tf:201–238` — `aws_cognito_user_pool_client.admin` (`ThinkworkAdmin`).
- `terraform/modules/foundation/cognito/main.tf:245–289` — `aws_cognito_user_pool_client.mobile` (`ThinkworkMobile`) — existing precedent for custom-scheme callbacks (`thinkwork://`, `thinkwork://auth/callback`).
- `terraform/modules/foundation/cognito/variables.tf:109–119` — `mobile_callback_urls` variable shape; mirror this for `desktop_callback_urls`.
- `terraform/modules/thinkwork/main.tf:139–156` — `concat()` block that computes admin callback URLs. The desktop scheme is added here.
- `scripts/build-spaces.sh` — env-injection pattern (Terraform outputs → `apps/spaces/.env.production` → renderer build). U15's `scripts/build-desktop.sh` mirrors this shape.
- `.github/workflows/release.yml` — existing tag-triggered release pipeline (all `ubuntu-latest`). U15 slots a new `macos-14` job alongside it.
- `apps/spaces/src/iframe-shell/iframe-shell.html` (lines 15–18) and `terraform/modules/app/static-site/main.tf:167+` — existing iframe-shell CSP precedent. The desktop `thinkwork://` host-bundle CSP is new; the iframe-shell CSP stays untouched.
- `/tmp/desktop-scout/t3code/apps/desktop/src/electron/ElectronProtocol.ts:58–141` — t3code's path-normalization + traversal-rejection + SPA-fallback logic, to port to `protocol.handle` (NOT `protocol.registerFileProtocol`, which is deprecated).
- `/tmp/desktop-scout/t3code/apps/desktop/src/updates/updateMachine.ts` — t3code's pure-reducer update state machine. Already Effect-free; port verbatim minus any unused Effect imports.
- `/tmp/desktop-scout/t3code/apps/desktop/src/preload.ts:22–127` — `contextBridge.exposeInMainWorld(name, { … } satisfies BridgeContract)` shape. Port the structure, not the SSH-specific methods.

### Institutional Learnings

- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` — canonical `resolveCaller` shape. The desktop main process must obtain `users.id` via `me`/`meUser` (not raw Cognito `sub`) before any downstream call. Honors memory `feedback_oauth_tenant_resolver` (`ctx.auth.tenantId` is null for Google-federated users; `resolveCallerTenantId(ctx)` fallback).
- `docs/solutions/security/rotate-api-auth-secret-2026-04-24.md` — pattern for rotating CI credentials through `gh secret set` + workflow re-trigger. Apple Developer credentials and (post-launch) Windows signing certs use the same shape.
- `docs/solutions/integration-issues/flue-supply-chain-integrity-2026-05-04.md` — trust-tier model for dependencies. Apply: Tier-1 (manual upgrade-review) for `electron`, `electron-builder`, `electron-updater`, `@electron/notarize`; Tier-2 for anything in preload; Tier-3 for everything else under `pnpm install --frozen-lockfile`. Extend `scripts/verify-supply-chain.sh` rather than inventing a parallel gate.
- `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md` — tsbuildinfo bootstrap incantation. Codify in `apps/desktop/README.md` from day one (U16).
- `docs/solutions/tooling-decisions/shadcn-add-cli-pnpm-workspace-vendor-pattern-2026-05-13.md` — vendoring rule for shadcn components (renderer-only concern; flagged here so any desktop scripts touching the component tree follow it).
- `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md` — CORS preflight contract. The Electron renderer's `fetch()` behaves like a browser fetch; the OAuth flow smoke must include an actual renderer-side fetch, not just a curl from main.
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` (memory `feedback_completion_callback_snapshot_pattern`) — snapshot env at `app.whenReady()`, thread through to IPC handlers, never re-read `process.env` after async work.

### External References

- [Electron 42 deep-links tutorial](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app) — `setAsDefaultProtocolClient` + `open-url` + `second-instance` patterns; `open-url` handler MUST be registered synchronously at module load (before `whenReady`).
- [Electron `protocol.handle`](https://www.electronjs.org/docs/latest/api/protocol) — modern (Electron 28+) replacement for the deprecated `protocol.registerFileProtocol`.
- [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) — async API preferred (`encryptStringAsync` / `decryptStringAsync`); sync API documented as "may be deprecated."
- [electron-vite 5.0 config docs](https://electron-vite.org/config/) — `renderer.configFile` + `renderer.root` delegate to an external Vite config (the lever we need for `apps/spaces/vite.config.ts`).
- [electron-builder mac docs](https://www.electron.build/mac) — `mac.zip` target is MANDATORY alongside DMG (Squirrel.Mac installs from zip, not DMG). `hardenedRuntime: true` and notarytool required for notarization in 2026.
- [electron-builder release-using-channels tutorial](https://www.electron.build/tutorials/release-using-channels.html) — channel separation via SemVer prerelease suffix + `generateUpdatesFilesForAllChannels: true`.
- [@electron/notarize 3.1](https://github.com/electron/notarize) — App Store Connect API key path preferred over Apple-ID + app-specific-password (key doesn't expire).
- [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/rfc9700/) — Jan 2025; makes PKCE S256 MUST for all OAuth clients, refresh-token rotation MUST for public clients.
- [Cognito using PKCE in authorization code grants](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html) — confirms Cognito supports PKCE for app clients without client secret.
- [Doyensec — Building a Secure Electron Auto-Updater (Feb 2026)](https://blog.doyensec.com/2026/02/16/electron-safe-updater.html) — manifest-signing pattern for v1.1 hardening.
- [Proofpoint — CursorJack (Mar 2026)](https://www.proofpoint.com/us/blog/threat-insight/cursorjack-weaponizing-deeplinks-exploit-cursor-ide) — validate deep-link URL path/query against tight allowlist in main before routing to renderer.
- [Apple Developer — Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) — notarytool reference; `altool` deprecated 2023-11-01.

---

## Key Technical Decisions

- **Package layout: `apps/desktop/` + `packages/desktop-ipc/`.** Package names `@thinkwork/desktop` and `@thinkwork/desktop-ipc`. Conventional-commit scope: `feat(desktop):`. `apps/desktop/` owns main, preload, and Electron config; `packages/desktop-ipc/` owns the Zod schemas + bridge interface shared by main, preload, and the renderer-side detection code in `apps/spaces`.
- **Electron version: 42.2 (or latest stable). `electron-vite` 5.0. `electron-builder` 26.x. `electron-updater` 6.x. `@electron/notarize` 3.x.** Node engine: ≥22 (already the monorepo floor).
- **Module format: ESM for both main and preload.** Electron 42 ships Node 24 — no reason to ship CJS like t3code does. `"type": "module"` in `apps/desktop/package.json`.
- **Protocol implementation: `protocol.handle` (Electron 28+ API), not `protocol.registerFileProtocol`.** t3code's pattern uses the deprecated API; port the path-normalization logic but rewrite atop `protocol.handle`.
- **Custom scheme per stage:** `thinkwork://` for production, `thinkwork-dev://` for dev, `thinkwork-canary://` for canary. macOS `LSHandler` doesn't isolate per-app; a single scheme shared across stages would let the most-recently-installed variant capture every callback. Each variant registers a distinct scheme synchronously at main module load.
- **OAuth flow: PKCE S256 + cryptographic state nonce + Cognito refresh-token rotation enabled.** Code verifier generated in main, kept in memory only, deleted after the token exchange. State nonce generated with `crypto.randomBytes`, validated on callback, mismatch rejected. RFC 9700 compliance.
- **Cognito client reuse: extend `ThinkworkAdmin` callback URLs; accept 30-day refresh-token validity for v1.** Avoids new Cognito infrastructure. Users who launch the app every 31+ days re-OAuth via system browser — acceptable for v1; raise to 90d (or mint `ThinkworkDesktop` client) if friction reports come in (Deferred to Follow-Up Work).
- **Auth hoist: refactor `apps/spaces/src/lib/auth.ts` to a pluggable `TokenStorage` interface.** Web variant constructs localStorage-backed; desktop variant constructs IPC-backed (proxies into main-process `safeStorage`). Required because `amazon-cognito-identity-js`'s `Storage` API is sync-only; sync IPC is an anti-pattern. Hoisting Cognito's refresh exchange into main is cleaner than a sync-IPC shim.
- **safeStorage usage: async API (`encryptStringAsync` / `decryptStringAsync`) + `getSelectedStorageBackend()` Linux detection.** Sync API may be deprecated. On Linux without a real backend, `safeStorage.getSelectedStorageBackend()` returns `basic_text` (hardcoded-password encryption) — refuse to persist and fall back to in-memory session, surface to renderer for a degraded-mode UI banner. `isEncryptionAvailable()` called AFTER `app.whenReady()` (per electron PR #48206 fix).
- **Update channel strategy: single GitHub repo (this monorepo) + SemVer prerelease suffix + `generateUpdatesFilesForAllChannels: true`.** Stable: `1.2.3`. Canary: `1.2.3-canary.1`. `allowPrerelease: false` on stable channel; only canary subscribers see prereleases. Avoids creating a separate release repo at v1.
- **CI publish token: GitHub App OIDC-bound, not long-lived PAT. Rotate quarterly.** Per 2024–2026 supply-chain incidents (Nx S1ngularity, Shai-Hulud, chalk/debug compromise), the release-publishing token is the highest-value secret in CI.
- **macOS code signing path: App Store Connect API key (`APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_KEY_ISSUER`) over Apple-ID + app-specific-password.** Key doesn't expire; cleaner CI secret rotation.
- **macOS build targets: separate arm64 + x64 DMG + zip (both per arch).** Half the per-user download vs universal. `mac.zip` is mandatory alongside DMG — Squirrel.Mac installs from zip, not DMG.
- **Renderer URL allowlist for `setWindowOpenHandler` + `will-navigate`:** only `thinkwork://app/*` may navigate in-window; external links must match `^https://([a-z0-9-]+\.)*thinkwork\.ai$` or the explicit OAuth/Google allowlist before `shell.openExternal` is called. All other navigation is denied.
- **Stage-specific `productName` and `userData` directory:** `ThinkWork Spaces` (prod), `ThinkWork Spaces (Dev)` (dev), `ThinkWork Spaces (Canary)` (canary). Each gets its own dock icon and userData dir so installs coexist without state collision.
- **Cognito identity resolution: `users.id` via `me`/`meUser`, NEVER raw Cognito `sub`.** Honors learning #4 (`oauth-authorize-wrong-user-id-binding-2026-04-21`). Main process resolves identity once after token exchange and threads `users.id` into all downstream calls.
- **iframe-shell stays at `https://sandbox.thinkwork.ai/`.** The brainstorm correctly preserves the iframe-shell as a separate origin for sandboxing guarantees. The desktop adds `thinkwork://app` to `var.computer_sandbox_allowed_parent_origins` so the iframe-shell accepts the desktop renderer as a parent (per `iframe-protocol.ts` origin check).
- **Terraform `computer_*` identifiers preserved through the app-package rename.** The `apps/computer` → `apps/spaces` rebrand (commit `dfc43c0d`) explicitly *"keeps Terraform `computer_*` compatibility contracts"* — variables (`var.computer_sandbox_allowed_parent_origins`, `var.computer_callback_urls`, etc.), outputs, the `terraform/modules/app/computer-runtime/` module, the `packages/computer-stdlib` / `packages/computer-runtime` workspace packages, and the `terraform/examples/greenfield/` reference deploy all retain `computer_*` names. Renaming them is a Registry breaking change with customer-migration cost; deferred to a separate effort (see Scope Boundaries → Deferred to Follow-Up Work). This plan touches only `var.computer_sandbox_allowed_parent_origins` and Cognito callback URLs — both extended additively, neither renamed.

---

## Open Questions

### Resolved During Planning

- **Cognito client strategy:** reuse `ThinkworkAdmin` and add `thinkwork://oauth/callback` to its callback URLs. Resolved per Key Technical Decisions.
- **Release feed location:** GitHub Releases on this monorepo. Resolved at brainstorm handoff (origin doc).
- **Channel separation mechanism:** SemVer prerelease suffix + `generateUpdatesFilesForAllChannels: true`. Resolved per electron-builder docs.
- **IPC payload schemas: share with `packages/api` or define new?** Define new in `packages/desktop-ipc/`. They don't overlap meaningfully with API schemas; sharing would couple desktop releases to API schema changes.
- **Bundler/dev mode orchestration:** `electron-vite` (HMR for renderer + auto-restart for main, single command). Removes the need for t3code's custom `dev-electron.mjs` watch+restart machinery — electron-vite does that natively.
- **Protocol handler API:** `protocol.handle` (Electron 28+), not the deprecated `protocol.registerFileProtocol`.
- **Module format:** ESM for main and preload.
- **macOS notarization tool:** notarytool via `@electron/notarize@3.x`. `altool` deprecated 2023-11-01.
- **Cognito CallbackURL allowlisting playbook:** mirror the `ThinkworkMobile` precedent (which already accepts `thinkwork://` schemes). Mechanically: add `desktop_callback_urls` variable + thread through `concat()` block in `terraform/modules/thinkwork/main.tf`.

### Deferred to Implementation

- **Exact electron-vite renderer config delegation shape** — the docs show `renderer.configFile` + `renderer.root` working; validate during U2 that all of `apps/spaces/vite.config.ts`'s plugins (`TanStackRouterVite`, `@tailwindcss/vite`, the `__SANDBOX_IFRAME_SRC__` define) load cleanly under electron-vite's wrapping. If not, fall back to importing `apps/spaces/vite.config.ts` and spreading it into `defineConfig({ renderer: {...config, ...overrides} })`.
- **TanStack Router OAuth callback timing** — confirm during U9 whether the renderer can subscribe to the IPC OAuth event during route resolution (`beforeLoad`) or whether the pattern needs to be "main buffers callback; renderer pulls via `consumePendingOAuthCallback()` IPC on mount." Pull-on-mount is the safer default.
- **iframe-shell CSP tightening** — start with web parity at v1; tighten later if specific directives prove safe. Don't ship a stricter CSP that breaks artifact rendering on day one.
- **Linux `safeStorage` fallback UI copy** — the brainstorm specifies the behavior (in-memory only + degraded-mode notice); exact UI string lives in implementation.
- **`pnpm wt:bootstrap` root script** — convenience script that does `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` before any typecheck. Mentioned in learnings but adopting it depends on whether other apps adopt it too.
- **Whether to set `ignore-scripts=true` in the desktop publisher CI environment** — recommended by best-practices research given 2024–2026 npm supply-chain incidents, but breaks any package using `postinstall` (some Electron native deps do). Evaluate during U15.
- **Cognito `RevokeToken` integration for Sign Out menu item** — main process calls `RevokeToken` endpoint on the refresh token before clearing local storage. Endpoint shape and error handling settled during U12.

---

## Output Structure

```
apps/desktop/
  package.json
  tsconfig.json
  electron.vite.config.ts
  electron-builder.yml
  README.md
  build/
    entitlements.mac.plist
    icons/
      icon.icns                     # macOS
      icon.png                      # source
      icon-dev.icns                 # dev variant
      icon-canary.icns              # canary variant
  src/
    main/
      index.ts                      # entry; registers open-url + scheme before whenReady
      app.ts                        # lifecycle (whenReady → bootstrap → shutdown)
      window.ts                     # BrowserWindow factory + hardened webPreferences
      protocol.ts                   # protocol.handle for thinkwork:// + CSP headers
      deep-link.ts                  # open-url buffer + second-instance + URL allowlist
      oauth.ts                      # PKCE + state nonce + Cognito hosted UI orchestration
      cognito-storage.ts            # ICognitoStorage over safeStorage; sync cache + debounced flush
      auth-bridge.ts                # exposes token state to renderer via IPC; calls /me to resolve users.id
      updates.ts                    # electron-updater wiring + state machine + arch detection
      update-machine.ts             # pure reducer (ported from t3code, Effect-free)
      menus.ts                      # native application menu (File/Edit/View/Window/Help + Check for Updates)
      ipc-handlers.ts               # registers all handlers from packages/desktop-ipc
      env.ts                        # snapshot at whenReady; never re-read process.env after
      telemetry.ts                  # update before/after install events + last-known-version
    preload/
      index.ts                      # contextBridge.exposeInMainWorld("thinkworkBridge", { ... } satisfies ThinkworkBridge)
  scripts/
    dev.mjs                         # optional: thin wrapper if electron-vite dev needs extension
  test/
    main/
      protocol.test.ts
      cognito-storage.test.ts
      deep-link.test.ts
      oauth.test.ts
      update-machine.test.ts
      env.test.ts

packages/desktop-ipc/
  package.json
  tsconfig.json
  src/
    index.ts                        # public re-exports
    channels.ts                     # all IPC channel constants
    bridge.ts                       # ThinkworkBridge interface
    schemas.ts                      # Zod schemas for every IPC payload + result
  test/
    schemas.test.ts

scripts/
  build-desktop.sh                  # env injection + electron-vite build + electron-builder

.github/workflows/
  release-desktop.yml               # macos-14 runner; tag-triggered; signed+notarized+published

apps/spaces/src/                  # modified, not created
  lib/
    auth.ts                         # refactored: takes TokenStorage interface
    token-storage/
      index.ts                      # TokenStorage interface
      local-storage.ts              # web variant
      desktop-bridge.ts             # desktop variant (via window.thinkworkBridge)
  routes/auth/
    desktop-callback.tsx            # new file-route for desktop OAuth callback

terraform/modules/foundation/cognito/
  main.tf                           # extended: desktop_callback_urls
  variables.tf                      # new: desktop_callback_urls input

terraform/modules/thinkwork/
  main.tf                           # extended: concat() includes desktop callback URLs
                                    # extended: var.computer_sandbox_allowed_parent_origins includes thinkwork://app
```

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Process model and IPC surface

```
┌──────────────────────────────── Electron main process ────────────────────────────────┐
│                                                                                       │
│  whenReady()                                                                          │
│    ├─ env.snapshot()           snapshot process.env once; pass via context object     │
│    ├─ cognito-storage.init()   load encrypted blob; safeStorage.isEncryptionAvailable │
│    ├─ protocol.handle(...)     serve thinkwork:// from built renderer + CSP headers   │
│    ├─ deep-link.drain()        replay any buffered open-url URLs                      │
│    ├─ ipc-handlers.register()  every channel from @thinkwork/desktop-ipc              │
│    ├─ menus.install()          native application menu                                │
│    ├─ updates.start()          electron-updater event wiring                          │
│    └─ window.createMain()      BrowserWindow with hardened webPreferences             │
│                                                                                       │
│  open-url (registered SYNC at top of main.ts, before whenReady)                       │
│    └─ deep-link.buffer(url)    pending[] until drain                                  │
│                                                                                       │
│  second-instance (Windows future / hardening)                                         │
│    └─ deep-link.routeArgv(argv)                                                       │
│                                                                                       │
│  IPC channels (all Zod-validated at boundary):                                        │
│    bridge.getSessionTokens()   →  { idToken, accessToken } | null                     │
│    bridge.startOAuth()         →  void (opens system browser)                         │
│    bridge.signOut()            →  void (RevokeToken + clear safeStorage)              │
│    bridge.consumePendingOAuth()→  { code, state } | null                              │
│    bridge.onDeepLink(cb)       →  unsubscribe fn                                      │
│    bridge.getUpdateState()     →  UpdateState                                         │
│    bridge.checkForUpdates()    →  void                                                │
│    bridge.downloadUpdate()     →  void                                                │
│    bridge.installUpdate()      →  void (relaunches)                                   │
│    bridge.onUpdateState(cb)    →  unsubscribe fn                                      │
│    bridge.reportInstallOutcome(o) → void (telemetry)                                  │
│                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │  contextBridge.exposeInMainWorld(
                                          │    "thinkworkBridge", { ... } satisfies ThinkworkBridge
                                          │  )
                                          ▼
┌────────────────────────────── Renderer (apps/spaces SPA) ──────────────────────────┐
│                                                                                      │
│  main.tsx detects window.thinkworkBridge presence                                    │
│    → constructs DesktopTokenStorage (IPC-backed)                                     │
│    → web build constructs LocalStorageTokenStorage                                   │
│    → AuthProvider initializes with chosen TokenStorage                               │
│                                                                                      │
│  /auth/desktop-callback route                                                        │
│    → on mount, calls bridge.consumePendingOAuth()                                    │
│    → token state flows through AuthContext                                           │
│    → navigate("/new")                                                                │
│                                                                                      │
│  AuthContext                                                                         │
│    → reads tokens via TokenStorage interface                                         │
│    → desktop variant: IPC round-trip to main; main owns safeStorage refresh exchange │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### OAuth flow (F1 — first launch)

```
Renderer                         Main process                  System browser    Cognito hosted UI
   │                                │                                │                  │
   │ click "Sign in with Google"    │                                │                  │
   │───────────────────────────────►│                                │                  │
   │                                │ generate PKCE verifier         │                  │
   │                                │ generate state nonce           │                  │
   │                                │ shell.openExternal(authURL)    │                  │
   │                                │───────────────────────────────►│                  │
   │                                │                                │  navigate        │
   │                                │                                │─────────────────►│
   │                                │                                │                  │
   │                                │                                │  user signs in   │
   │                                │                                │  302 redirect to │
   │                                │                                │  thinkwork://    │
   │                                │                                │  oauth/callback  │
   │                                │                                │◄─────────────────│
   │                                │                                │                  │
   │                                │  OS routes URL                 │                  │
   │                                │◄──── open-url event ───────────│                  │
   │                                │ validate state; validate URL   │                  │
   │                                │ allowlist; exchange code +     │                  │
   │                                │ verifier at Cognito token EP   │                  │
   │                                │───────────────────────────────────────────────────►
   │                                │◄──────────── id+access+refresh tokens ─────────────
   │                                │ resolveCaller → users.id       │                  │
   │                                │ cognito-storage.write tokens   │                  │
   │                                │ encrypt + flush                │                  │
   │                                │ broadcast onDeepLink to        │                  │
   │                                │ renderer                       │                  │
   │ /auth/desktop-callback mounts  │                                │                  │
   │ bridge.consumePendingOAuth()   │                                │                  │
   │───────────────────────────────►│                                │                  │
   │◄──────── { ok: true } ─────────│                                │                  │
   │ AuthContext hydrates           │                                │                  │
   │ navigate("/new")               │                                │                  │
```

### Update state machine

```
disabled ──checkForUpdates──► checking ─────update-not-available───► up-to-date
                                  │                                       │
                                  │ update-available                      │ checkForUpdates
                                  ▼                                       │
                              available ◄────────────────────────────────┘
                                  │
                                  │ downloadUpdate
                                  ▼
                              downloading ──download-progress──► downloading (percent updated)
                                  │
                                  │ update-downloaded
                                  ▼
                              downloaded ──installUpdate (quitAndInstall)──► [process exits]
                                                                                  │
                                                                                  │ next launch
                                                                                  ▼
                                                                              up-to-date

                error (canRetry=true) ◄── any failure during checking/downloading/install
```

---

## Implementation Units

### U1. OAuth deep-link cold-start spike (gating)

**Goal:** Validate the highest-risk part of the plan — that `app.setAsDefaultProtocolClient('thinkwork')` + `open-url` cold-start buffering + PKCE round-trip with Cognito hosted UI + safeStorage degraded-mode detection all work end-to-end on macOS Sonoma+ — before committing the full pipeline. Produces a one-page validation report, not production code.

**Requirements:** R7, R8, R9, R22

**Dependencies:** None (gating step)

**Files:**
- Create: throwaway spike branch / worktree under `.claude/worktrees/desktop-spike/` (not merged)
- Create: spike report at `docs/solutions/spikes/2026-05-NN-electron-oauth-cold-start-validation.md` (or equivalent path, post-spike)

**Approach:**
- Scaffold a minimal Electron 42 app outside the monorepo (or in a throwaway worktree); ship `apps/spaces` as the renderer via `protocol.handle` from a built `dist/`.
- Validate the 7-scenario matrix from the brainstorm Outstanding Question (cold start, warm start, dev mode, stage collision, PKCE round-trip, state validation, safeStorage edge cases).
- Confirm `open-url` registered synchronously at top of main.ts fires before `whenReady` on cold-launch-via-URL.
- Confirm `thinkwork-dev://` and `thinkwork://` distinct schemes don't collide on macOS.
- Confirm Cognito hosted UI accepts a PKCE-only public client request.
- Validate safeStorage degraded mode (lock keychain manually, observe `isEncryptionAvailable() === false`).

**Execution note:** Spike, not production. Output is decisions, not committed code. The spike report establishes which timing/buffering pattern is correct for U7/U8/U9.

**Patterns to follow:**
- [Electron deep-links tutorial](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
- [bloomca.me — Custom Protocols and Deeplinking in Electron apps (2025)](https://blog.bloomca.me/2025/07/20/electron-apps-custom-protocols.html)

**Test scenarios:**
- Validation matrix scenarios (executed manually + documented in spike report). For each: state setup → action → observed behavior → pass/fail.
- Test expectation: spike report committed; no production tests for spike code.

**Verification:**
- Spike report exists at the agreed path, lists all 7 scenarios, marks each pass/fail, names the buffering pattern chosen for production, and flags any newly-discovered constraints. If any scenario fails in a way that invalidates the brainstorm's approach, escalate to user before proceeding to U2.

---

### U2. Scaffold `apps/desktop/` package + electron-vite config (with build-time `__DESKTOP_BUILD__` define)

**Goal:** Create the new app package with electron-vite delegating to `apps/spaces`'s renderer config, bundling main + preload as ESM, and producing a launchable Electron app that loads `apps/spaces/dist/` via the `thinkwork://` protocol handler. Inject a build-time `__DESKTOP_BUILD__` define via electron-vite's renderer config override (NOT inside `apps/spaces/vite.config.ts`, which stays untouched) so the renderer can switch desktop-specific branches at compile time and tree-shake the web bundle clean of desktop dead code.

**Requirements:** R20, R21

**Dependencies:** U1 (gating spike must pass)

**Files:**
- Create: `apps/desktop/package.json` (name: `@thinkwork/desktop`, type: module, electron + electron-vite + electron-builder + electron-updater + @electron/notarize deps)
- Create: `apps/desktop/tsconfig.json` (extends `tsconfig.base.json`)
- Create: `apps/desktop/electron.vite.config.ts` (main + preload bundles + renderer delegated to `apps/spaces/vite.config.ts` via `renderer.configFile`)
- Create: `apps/desktop/src/main/index.ts` (skeleton: synchronous open-url registration stub + whenReady chain)
- Create: `apps/desktop/src/main/app.ts` (lifecycle skeleton)
- Create: `apps/desktop/src/main/window.ts` (BrowserWindow factory with hardened `webPreferences`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, preload pointer)
- Create: `apps/desktop/src/main/env.ts` (snapshot at whenReady; see `feedback_completion_callback_snapshot_pattern`)
- Create: `apps/desktop/src/preload/index.ts` (skeleton `contextBridge.exposeInMainWorld("thinkworkBridge", {})`)
- Create: `apps/desktop/README.md` (dev-bootstrap instructions including tsbuildinfo incantation)
- Modify: root `pnpm-workspace.yaml` if needed (likely no change — `apps/*` already covered)
- Test: `apps/desktop/test/main/env.test.ts` (env snapshot returns expected shape)

**Approach:**
- `electron.vite.config.ts` exports `defineConfig({ main: {...}, preload: {...}, renderer: { root: '../computer', configFile: '../computer/vite.config.ts', define: { __DESKTOP_BUILD__: 'true' } } })`. The `define` injection lives in electron-vite's renderer override, so `apps/spaces/vite.config.ts` stays untouched (the web Vite build never defines the symbol; `typeof __DESKTOP_BUILD__ === 'undefined'` coerces to `false` in conditionals).
- `apps/spaces/tsconfig.json` (or a shared types file in `apps/spaces/src/`) declares `declare const __DESKTOP_BUILD__: boolean;` so TypeScript knows the symbol exists at type-check time. The declaration default-narrows to `boolean` — both web and desktop type-check cleanly.
- `build.externalizeDeps: true` (electron-vite 5 default) — only devDependencies bundled into main/preload.
- Window initial size 1100x780; min 840x620; `show: false`; theme-matched `backgroundColor`; `titleBarStyle: 'hiddenInset'` on macOS with `trafficLightPosition: { x: 14, y: 14 }`.
- `apps/desktop/package.json` scripts: `dev`, `build`, `package`, `typecheck`, `test`, `lint` (stub per `apps/cli` precedent).
- `Node ≥ 22` engines field.

**Patterns to follow:**
- [electron-vite 5.0 config](https://electron-vite.org/config/)
- `apps/spaces/package.json` for script naming + version conventions.
- `/tmp/desktop-scout/t3code/apps/desktop/src/preload.ts:22–127` for `contextBridge.exposeInMainWorld(name, { … } satisfies BridgeContract)` shape — adapt to plain TS.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/desktop typecheck` succeeds.
- Happy path: `pnpm --filter @thinkwork/desktop build` produces `out/main/index.js` + `out/preload/index.js` + `out/renderer/index.html`.
- Happy path: `pnpm --filter @thinkwork/desktop dev` launches Electron, BrowserWindow appears, theme-matched background visible before content loads.
- `env.test.ts`: env snapshot taken at fake whenReady contains all expected keys; mutating `process.env` after snapshot does not affect the snapshot value.

**Verification:**
- `apps/desktop/` is a valid pnpm workspace member.
- Electron launches in dev mode and shows a blank window with the correct chrome.
- The build output structure matches the Output Structure tree.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` all pass at repo root.

---

### U3. Shared IPC contract package `packages/desktop-ipc/`

**Goal:** Define every IPC channel constant, the `ThinkworkBridge` interface that preload exposes, and Zod schemas for every payload and result — in a single shared package consumed by `apps/desktop/main`, `apps/desktop/preload`, and `apps/spaces` (for the renderer-side bridge type).

**Requirements:** R14, R15

**Dependencies:** U2

**Files:**
- Create: `packages/desktop-ipc/package.json` (name: `@thinkwork/desktop-ipc`, no build step — `"main": "./src/index.ts"`)
- Create: `packages/desktop-ipc/tsconfig.json`
- Create: `packages/desktop-ipc/src/index.ts` (public re-exports)
- Create: `packages/desktop-ipc/src/channels.ts` (all IPC channel name constants, e.g. `GET_SESSION_TOKENS = "desktop:get-session-tokens"`)
- Create: `packages/desktop-ipc/src/bridge.ts` (`ThinkworkBridge` interface)
- Create: `packages/desktop-ipc/src/schemas.ts` (Zod schemas for every payload + result + event; includes the explicit `DeepLinkCallback = { code: string; state: string }` schema that U7 produces and U8 consumes — named to make the U7↔U8 contract type-checked at compile time)
- Create: `packages/desktop-ipc/src/handler-guards.ts` (shared helpers — see Approach)
- Test: `packages/desktop-ipc/test/schemas.test.ts`

**Approach:**
- Channels covered: `bridge.getSessionTokens`, `startOAuth`, `signOut`, `consumePendingOAuth`, `onDeepLink`, `getUpdateState`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, `onUpdateState`, `reportInstallOutcome`.
- Each channel pairs a request Zod schema and a response Zod schema (or event Zod schema for `on*` subscriptions).
- `ThinkworkBridge` interface uses `z.infer` types from `schemas.ts` so updating a schema updates the surface automatically.
- `DeepLinkCallback` schema is exported by name so both U7 (produces it) and U8 (consumes it) reference the same type — drift caught at compile time.
- `handler-guards.ts` exports two shared helpers used by every main-process IPC handler: (a) `assertSafeSenderFrame(event)` — rejects calls whose `event.senderFrame.url` doesn't start with `thinkwork://app/` (production) or the dev-server URL (dev). Defense-in-depth against future regressions that load untrusted content into a frame. (b) `rateLimit({ key, intervalMs })` — token-bucket throttle. Sensitive handlers (`signOut`, `startOAuth`) wrap themselves at 1 call per 2s to prevent XSS-via-supply-chain grief spam.
- No runtime deps beyond `zod` (already in monorepo, v4).
- Follows the `@thinkwork/ui` / `@thinkwork/graph` / `@thinkwork/computer-stdlib` pattern: `"main": "./src/index.ts"` so consumers import the TS directly with no build step.

**Patterns to follow:**
- `packages/ui/`, `packages/graph/`, `packages/computer-stdlib/` for the no-build-step shared-package shape.
- t3code's `apps/desktop/src/ipc/channels.ts` and `apps/desktop/src/ipc/DesktopIpc.ts:130–170` for the channel-constants + payload/result codec pattern (port concept; rewrite atop Zod, not Effect Schema).

**Test scenarios:**
- Happy path: every channel schema parses a valid example payload successfully.
- Edge case: every channel schema rejects an empty `{}` (where required fields exist) and surfaces the missing field.
- Edge case: schema for `consumePendingOAuth` response handles both `{ code, state }` shape and `null` shape (no pending callback).
- Edge case: `UpdateState` schema accepts every status enum value (`disabled | checking | available | downloading | downloaded | up-to-date | error`).
- Happy path: `DeepLinkCallback` schema parses `{ code: "abc", state: "xyz" }` and rejects extra fields.
- Happy path (`assertSafeSenderFrame`): event with `senderFrame.url = "thinkwork://app/"` passes; event with `senderFrame.url = "https://evil.example/"` throws.
- Happy path (`rateLimit`): first call within window succeeds; second call within window rejects with rate-limit error; call after window succeeds.

**Verification:**
- `pnpm --filter @thinkwork/desktop-ipc typecheck && test` passes.
- Importing `ThinkworkBridge` from `apps/desktop/src/preload/index.ts` produces a type that matches the shape exposed via `satisfies ThinkworkBridge`.

---

### U4. Custom `thinkwork://` protocol handler with traversal-safe path resolution, SPA fallback, and CSP headers

**Goal:** Serve the built renderer from disk via the custom `thinkwork://` scheme. Register the scheme as privileged (standard + secure + supportFetchAPI + corsEnabled) BEFORE `app.whenReady()`. Set strict CSP headers on the response. Reject `..` traversal segments; fall back to `index.html` for SPA routes; return 403/404 appropriately for missing assets.

**Requirements:** R4, R5, R6, R19

**Dependencies:** U2

**Files:**
- Create: `apps/desktop/src/main/protocol.ts` (`protocol.handle("thinkwork", ...)` + CSP headers)
- Modify: `apps/desktop/src/main/index.ts` (synchronous `protocol.registerSchemesAsPrivileged` call at top of file, before any `await`)
- Modify: `apps/desktop/src/main/window.ts` (load `thinkwork://app/` in production; load Vite dev server URL in dev)
- Test: `apps/desktop/test/main/protocol.test.ts`

**Approach:**
- Scheme registration is synchronous at module top-level, NOT inside `whenReady` callback. Failing this means the renderer can't use service workers / fetch / secure-context APIs.
- Use Electron 28+ `protocol.handle` (NOT the deprecated `protocol.registerFileProtocol` from t3code).
- Path normalization rejects any decoded path segment equal to `..`. Resolved target must start with the renderer root (`path.sep` boundary check).
- SPA fallback: if the resolved path has no file extension AND no `index.html` exists at that nested dir, fall back to `<root>/index.html`.
- CSP set inline on the `Response` returned from the handler. Directives are pinned at plan time (NOT "finalized in implementation") because the host bundle is a closed surface — there is no reason to inherit the looser web CSP. Specific AWS resource IDs (API Gateway ID, AppSync API ID, Cognito domain) are injected at build time from Terraform outputs via the same env-injection pattern as `scripts/build-spaces.sh`, so the CSP wildcards become specific IDs rather than `*.execute-api.us-east-1.amazonaws.com` (broader than intended; matches any AWS account in the region):

  ```
  default-src 'self' thinkwork://app;
  script-src 'self' thinkwork://app;
  style-src 'self' thinkwork://app 'unsafe-inline';      # Tailwind v4 injects inline <style> for arbitrary classes
  img-src 'self' thinkwork://app data: https://*.thinkwork.ai;
  font-src 'self' thinkwork://app data:;
  connect-src 'self' thinkwork://app
    https://<API_GATEWAY_ID>.execute-api.us-east-1.amazonaws.com
    https://<APPSYNC_API_ID>.appsync-api.us-east-1.amazonaws.com
    wss://<APPSYNC_API_ID>-ats.appsync-realtime-api.us-east-1.amazonaws.com
    https://<COGNITO_DOMAIN>.auth.us-east-1.amazoncognito.com;
  frame-src https://sandbox.thinkwork.ai;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
  ```

  `<API_GATEWAY_ID>`, `<APPSYNC_API_ID>`, `<COGNITO_DOMAIN>` placeholders are replaced at build time per stage. `connect-src` deliberately does NOT wildcard `*.appsync-realtime-api.us-east-1.amazonaws.com` (which would match any AWS account in the region) — must be the specific API ID.

**Patterns to follow:**
- `/tmp/desktop-scout/t3code/apps/desktop/src/electron/ElectronProtocol.ts:58–141` (port path-normalization and SPA-fallback logic, rewrite atop `protocol.handle`).
- `apps/spaces/src/iframe-shell/iframe-shell.html` (existing iframe-shell CSP) — for reference on what's already locked down at the iframe boundary.

**Test scenarios:**
- Happy path: GET `thinkwork://app/index.html` returns 200 + content-type `text/html` + CSP header.
- Happy path: GET `thinkwork://app/assets/index-abc123.js` returns 200 + content-type `application/javascript`.
- Happy path: GET `thinkwork://app/agents/some-agent` (SPA deep route) returns `index.html` with 200.
- Edge case: GET `thinkwork://app/../../../etc/passwd` returns 403 — the `..` segment is rejected during normalization.
- Edge case: GET `thinkwork://app/assets/does-not-exist.js` returns 404 (asset request — has extension).
- Edge case: GET `thinkwork://app/` (root) returns `index.html`.
- Integration: a fetch from the renderer to `thinkwork://app/index.html` succeeds and returns the same content as the file on disk.
- CSP enforcement: a script tag from a non-allowlisted origin injected into a test HTML page is blocked by the CSP set on the response.

**Verification:**
- The renderer loads in production-built mode from `thinkwork://app/` and all SPA routes resolve correctly on reload.
- Browser DevTools "Application → Service Workers" panel shows the secure-context flag is set.
- The CSP header is present on the document response and matches the expected directives.

---

### U5. `safeStorage`-backed Cognito storage backend in main

**Goal:** Implement `ICognitoStorage` over `Electron.safeStorage` with a sync in-memory cache and a debounced encrypted-file flush. Detect Linux `basic_text` fallback and refuse to persist (in-memory session only). Wait for `app.whenReady()` before calling `isEncryptionAvailable()`. Use the async safeStorage API.

**Requirements:** R9, R10, R24

**Dependencies:** U2

**Files:**
- Create: `apps/desktop/src/main/cognito-storage.ts`
- Test: `apps/desktop/test/main/cognito-storage.test.ts`

**Approach:**
- Class implements `ICognitoStorage` (sync `getItem` / `setItem` / `removeItem` / `clear`).
- In-memory `Map<string, string>` is the source of truth for sync reads.
- `setItem` / `removeItem` / `clear` schedule a debounced (100ms) async flush that calls `safeStorage.encryptStringAsync(JSON.stringify(Object.fromEntries(cache)))` and `fs.writeFile`.
- On construction (called from whenReady chain), if `safeStorage.isEncryptionAvailable() === false` OR `safeStorage.getSelectedStorageBackend() === 'basic_text'` (Linux without libsecret), skip disk hydration; cache stays empty; persistence is in-memory only; surface degraded-mode signal to the auth bridge.
- Vault file path: `path.join(app.getPath('userData'), 'cognito-vault.bin')`.
- All five Cognito key shapes supported: `CognitoIdentityServiceProvider.<clientId>.<username>.{idToken,accessToken,refreshToken,clockDrift}` + `CognitoIdentityServiceProvider.<clientId>.LastAuthUser`.
- `clear()` deletes the vault file (not just clears the cache).

**Patterns to follow:**
- [Electron safeStorage docs](https://www.electronjs.org/docs/latest/api/safe-storage) — async API + `getSelectedStorageBackend()`.
- `feedback_completion_callback_snapshot_pattern` — env/config snapshotted at whenReady, threaded through.

**Test scenarios:**
- Happy path: `setItem("foo", "bar")` → `getItem("foo") === "bar"` immediately (sync cache hit before debounced flush fires).
- Happy path: `setItem` triggers a debounced flush; after the debounce window, the vault file exists and decrypts to the expected JSON.
- Edge case: rapid burst of 10 `setItem` calls within the debounce window produces exactly one disk flush, not 10.
- Edge case: `safeStorage.isEncryptionAvailable() === false` at init → no vault file written; subsequent `setItem` updates cache but never flushes; `degradedMode` flag is true.
- Edge case: Linux `basic_text` backend detected → treated as unavailable; same as above.
- Edge case: vault file exists but decrypts to invalid JSON (corruption) → cache starts empty; degraded-mode flag set; corrupted file logged.
- Integration: hydrate cache from a prior session's vault file → all five Cognito keys round-trip correctly.
- Error path: `safeStorage.encryptStringAsync` rejects → next debounced flush logs the error; cache stays correct; no infinite-retry loop.

**Verification:**
- The vault file is created on first `setItem` and survives app restart.
- A vault encrypted by one app instance can be decrypted by the next launch.
- Linux degraded-mode is correctly detected against `getSelectedStorageBackend()`.

---

### U6. Refactor `apps/spaces/src/lib/auth.ts` to `TokenStorage` interface (web-only; characterization-gated)

**Goal:** Introduce a `TokenStorage` interface that abstracts the 8+ direct `localStorage` calls in `apps/spaces/src/lib/auth.ts`. Land the web variant (`LocalStorageTokenStorage`) and prove web behavior is unchanged via characterization test BEFORE any desktop code exists. This unit ships green to web users in isolation with zero desktop coupling. (Desktop variant + main-process auth-bridge are split off into U17.)

**Requirements:** R10, R24

**Dependencies:** None (apps/spaces only; no U3, no U5)

**Files:**
- Create: `apps/spaces/src/lib/token-storage/index.ts` (`TokenStorage` interface)
- Create: `apps/spaces/src/lib/token-storage/local-storage.ts` (web variant)
- Modify: `apps/spaces/src/lib/auth.ts` (replace direct `localStorage` calls with `TokenStorage` interface calls)
- Modify: `apps/spaces/src/main.tsx` (construct `LocalStorageTokenStorage` and pass to AuthProvider; the `__DESKTOP_BUILD__` conditional branch is added later in U17)
- Test: `apps/spaces/src/lib/token-storage/local-storage.test.ts`
- Test: `apps/spaces/src/lib/auth.test.ts` (NEW characterization test — sign-in → cold reload → token-restored end-to-end against the refactored interface)

**Approach:**
- `TokenStorage` interface: `getItem(key: string): string | null`, `setItem(key, value): void`, `removeItem(key): void`, `clear(): void`, `subscribe(listener): unsubscribe`. Sync read API matches `amazon-cognito-identity-js`'s `ICognitoStorage` contract.
- `LocalStorageTokenStorage` wraps `localStorage` directly — preserves the current behavior of `auth.ts` exactly. The `subscribe` method uses `window.addEventListener('storage', ...)` so cross-tab token changes propagate (same behavior as today's implicit storage-event reads).
- The `auth.ts` `getStoredIdToken()` fallback path (currently reads localStorage directly when `getCurrentSession()` returns null for federated users) goes through `TokenStorage.getItem` instead. Same Cognito key layout (`CognitoIdentityServiceProvider.<CLIENT_ID>.<user>.*`).
- `apps/spaces/src/main.tsx` constructs a `LocalStorageTokenStorage` and passes it to `AuthProvider`. In U17, this branch becomes `__DESKTOP_BUILD__ ? new DesktopBridgeTokenStorage() : new LocalStorageTokenStorage()`.

**Execution note:** Start with the characterization test for the existing web auth flow against the CURRENT codebase to lock in observable behavior. Then introduce the `TokenStorage` interface, refactor `auth.ts` behind it, prove the characterization test still passes. THEN merge. The desktop variant comes in U17.

**Patterns to follow:**
- The existing `apps/spaces/src/routes/_authed.tsx` federation-fallback path (lines 14–25) for how the renderer treats the fallback storage read.
- Learning `oauth-authorize-wrong-user-id-binding-2026-04-21` — main process resolves `users.id` via `me`/`meUser` after token exchange; this rule applies in U17 when main owns the refresh exchange.

**Test scenarios:**
- Happy path: `LocalStorageTokenStorage.setItem("x","y")` writes to localStorage; `getItem("x")` returns `"y"`.
- Happy path (characterization): existing web sign-in flow (Google OAuth → callback → token persistence → `/new`) works unchanged after the refactor — same network calls, same localStorage key writes, same final route.
- Happy path (characterization): cold-reload-while-signed-in path (`getStoredIdToken()` fallback for federated users per `_authed.tsx` lines 14–25) works unchanged.
- Happy path (subscribe): cross-tab storage event propagates to subscribers.
- Edge case: `LocalStorageTokenStorage.removeItem` for a non-existent key is a no-op (matches localStorage semantics).
- Integration: every `localStorage.getItem(\`CognitoIdentityServiceProvider.${CLIENT_ID}.*\`)` call site in `auth.ts` now flows through `TokenStorage.getItem` and returns identical values.

**Verification:**
- `apps/spaces` web build is functionally unchanged — existing test suite passes; manual sign-in/sign-out/cold-reload flow works on dev stage.
- No new desktop dependencies introduced (`apps/desktop` need not exist for this unit to ship).

---

### U7. Deep-link handler + single-instance lock + URL allowlist (per-stage scheme isolation)

**Goal:** Register `thinkwork://` (or `thinkwork-dev://` / `thinkwork-canary://` per stage) as the default protocol client. Install the `open-url` handler synchronously at main module load. Buffer URLs that arrive before the renderer is ready; drain when the OAuth IPC is live. Validate URL path + query against a tight allowlist before routing to the renderer (CursorJack lesson). Acquire the single-instance lock for Windows-future readiness.

**Requirements:** R5, R7

**Dependencies:** U2

**Files:**
- Create: `apps/desktop/src/main/deep-link.ts`
- Modify: `apps/desktop/src/main/index.ts` (call `app.setAsDefaultProtocolClient` + register `open-url` listener SYNCHRONOUSLY at top of module; `app.requestSingleInstanceLock()` + `second-instance` listener)
- Modify: `apps/desktop/package.json` (electron-builder `protocols` config per stage; lives in `electron-builder.yml` in U14, but the scheme constant is shared)
- Test: `apps/desktop/test/main/deep-link.test.ts`

**Approach:**
- Per-stage scheme constant resolved from build-time env or `productName`: `thinkwork` (prod), `thinkwork-dev` (dev), `thinkwork-canary` (canary).
- `open-url` registration at the top of `main.ts`, BEFORE any `await`. Without this, cold-start URL delivery is lost.
- Pending-URL queue + drain pattern: any URL arriving before the IPC handler is registered goes into a module-level array; drain it once `IPC_OAUTH_READY` channel signals ready.
- URL allowlist: only `<scheme>://oauth/callback` paths with `?code=...&state=...` queries pass through. Any other path or unexpected query parameter is rejected with a logged warning.
- Single-instance lock: acquired at module load; if not the primary instance, quit. `second-instance` handler parses `argv` for any URL starting with the scheme and routes through the same allowlist.
- Windows-future readiness: `process.argv` is also inspected on cold start (Windows delivers protocol URLs in argv, not via `open-url`).

**Patterns to follow:**
- [Electron deep-links tutorial](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
- [bloomca.me — Custom Protocols and Deeplinking in Electron apps](https://blog.bloomca.me/2025/07/20/electron-apps-custom-protocols.html)

**Test scenarios:**
- Happy path: `open-url` event with a valid `thinkwork://oauth/callback?code=abc&state=xyz` → URL is buffered; on drain, the IPC handler receives `{ code: "abc", state: "xyz" }`.
- Happy path: `open-url` event fires while the buffer is already drained → URL routes immediately, no buffering.
- Happy path: single-instance lock acquired on first launch; second launch quits cleanly.
- Edge case: URL with disallowed path `thinkwork://malicious/command?cmd=rm` → rejected; warning logged; not routed to renderer (CursorJack defense).
- Edge case: URL with valid path but extra unexpected query parameters → rejected (strict allowlist).
- Edge case: URL with valid path but missing `code` or `state` → rejected.
- Edge case: cold-start argv on Windows (`process.argv` contains the URL) → URL is buffered the same as `open-url`.
- Error path: a malformed URL (no scheme separator) → caught by URL constructor; not crashed.

**Verification:**
- Clicking a `thinkwork://oauth/callback?code=...&state=...` URL while the app is not running launches the app and delivers the URL through the IPC pipeline.
- Clicking the same URL while the app is already open routes the URL to the same instance (no duplicate process).
- Stage isolation: prod and dev builds installed side-by-side each receive their own scheme's URLs without collision.

---

### U8. OAuth flow with PKCE S256 + state nonce + Cognito refresh-token rotation + RevokeToken failure contract

**Goal:** Implement the desktop OAuth flow end-to-end in main: generate PKCE verifier + state nonce per attempt with explicit TTL + cleanup-on-quit lifecycle; open Cognito hosted UI in system browser via `shell.openExternal`; receive the deep-link callback from U7; validate state; exchange `code + verifier` for tokens at the Cognito token endpoint; resolve `users.id` via `meUser`; persist via the safeStorage backend from U5; broadcast tokens to the renderer. Sign-out follows an explicit clear-first / retry-revoke / persist-failed-queue contract.

**Requirements:** R8, R10, R22, R23

**Dependencies:** U5, U7, U10, U17 (U10 must be applied to the target stage before U8's integration test can pass; U17 supplies the renderer-side IPC plumbing the OAuth callback writes through)

**Files:**
- Create: `apps/desktop/src/main/oauth.ts` (PKCE + state generation, Cognito hosted-UI URL composition, token exchange, sign-out + revocation)
- Modify: `apps/desktop/src/main/ipc-handlers.ts` (register `startOAuth`, `consumePendingOAuth`, `signOut` handlers from `@thinkwork/desktop-ipc`)
- Test: `apps/desktop/test/main/oauth.test.ts`

**Approach:**
- **PKCE:** `crypto.randomBytes(32)` → base64url → verifier. SHA-256 → base64url → challenge. Verifier stored in main-process memory in a `Map<state, { verifier, createdAt, next? }>`, never persisted to disk.
- **PKCE lifecycle (hardened):**
  - **TTL: 10 minutes.** Background timer evicts entries older than 600s — generous for user dwell (browser tab, password manager, federation provider delay), tighter than indefinite. Matches Cognito's authorization code TTL (60s) with buffer.
  - **Hard cap: 5 in-flight attempts.** If a user has 5 outstanding sign-in attempts, evict the oldest on overflow. A user with 5+ in-flight attempts is signaling a different problem.
  - **Zeroize on `before-quit`:** overwrite verifier bytes with random data before deleting references, so post-quit memory dumps don't yield credentials. Cheap paranoia for a public OAuth client.
  - **Cleanup after exchange:** verifier deleted from the map immediately on successful token exchange; also deleted on terminal exchange failure.
  - **`next?` field:** if the renderer passed a `next` destination to `bridge.startOAuth({ next })`, it's stored HERE keyed by state — NEVER sourced from the callback URL. U9 reads it via `bridge.consumePendingOAuth()`'s response shape `{ code, state, next? }`. This is the only safe way to carry `next` in a desktop OAuth flow given the CursorJack-style threat model.
- **State nonce:** `crypto.randomBytes(16)` → hex string. Stored as the map key alongside verifier; validated on callback (mismatch → reject + log; verifier evicted; renderer notified via error event).
- **Cognito hosted UI URL:** `https://<COGNITO_DOMAIN>/oauth2/authorize?response_type=code&client_id=<ADMIN_CLIENT_ID>&redirect_uri=thinkwork://oauth/callback&scope=openid+email+profile+aws.cognito.signin.user.admin&code_challenge=<challenge>&code_challenge_method=S256&state=<state>&identity_provider=Google`.
- **Token exchange:** POST to `https://<COGNITO_DOMAIN>/oauth2/token` with `grant_type=authorization_code&client_id=<ADMIN_CLIENT_ID>&code=<code>&redirect_uri=thinkwork://oauth/callback&code_verifier=<verifier>`. Public client → no client secret.
- **Identity resolution:** after token exchange, main calls `GET /me` (or the GraphQL `meUser` query) to get the authoritative `users.id`. This becomes the `username` portion of the Cognito storage keys. Never use raw Cognito `sub` (learning `oauth-authorize-wrong-user-id-binding-2026-04-21`).
- **Sign-out (explicit failure contract):**
  1. **Always clear local storage first.** User intent is "sign out from this device" — local state goes immediately regardless of network outcome.
  2. **Then call Cognito `RevokeToken` with retry:** 3 attempts, exponential backoff, 5s total budget.
  3. **On terminal revoke failure:** broadcast `signedOut` event with `{ ok: true, revokeFailed: true }` so the renderer can surface "Sign-out complete locally, but server-side revocation failed — please sign out from another device or wait until token expires." Persist the failed-revocation entry (token-string-only; opaque to anything except Cognito) to `userData/pending-revocations.json`.
  4. **On next launch:** drain the pending-revocations queue before any other startup work — retry revocation, remove successful entries. Prevents accumulating phantom revocations.
  5. **Cited contract:** RFC 7009 §2.1 — "the authorization server responds with HTTP status code 200 if the token has been revoked successfully or if the client submitted an invalid token." Cognito conforms.
- **Refresh-token rotation:** handled by `amazon-cognito-identity-js` automatically once enabled on the Cognito client (U10).
- **Configuration:** read `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN` from the env snapshot (U2).
- **`assertSafeSenderFrame` + `rateLimit`:** every IPC handler in this unit wraps itself via the U3 helpers. `startOAuth` is rate-limited to 1 per 2 seconds; `signOut` is rate-limited to 1 per 2 seconds.

**Patterns to follow:**
- [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/rfc9700/) for PKCE + state requirements.
- [Cognito PKCE docs](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html) for the exact request shape.
- Existing `apps/spaces/src/lib/auth.ts` `getGoogleSignInUrl()` + `exchangeCodeForSession()` — the desktop variant mirrors the URL shape and exchange, with PKCE additions.

**Test scenarios:**
- Happy path: `startOAuth` generates fresh verifier + state, returns the auth URL with `code_challenge` + `state` query params.
- Happy path: callback arrives with matching `code + state`; token exchange succeeds; tokens persisted via safeStorage backend; `tokensChanged` event broadcast to renderer.
- Happy path: `meUser` resolves to a `users.id`; cognito-storage keys are written with that id as username.
- Happy path (sign-out, revoke succeeds): local storage cleared first, RevokeToken returns 200, `signedOut { ok: true, revokeFailed: false }` broadcast.
- Happy path (sign-out with `next`): `startOAuth({ next: "/automations/123" })` stores `next` keyed by state; callback flows; `consumePendingOAuth()` returns `{ code, state, next: "/automations/123" }`.
- Edge case: callback arrives with mismatched state → token exchange NOT attempted; warning logged; verifier evicted from map.
- Edge case: callback arrives with a `code` that was already exchanged (replay) → second exchange fails with Cognito error; cleanly surfaced.
- Edge case: PKCE verifier was already deleted (multiple callbacks for same state) → token exchange NOT attempted.
- Edge case: `meUser` returns null/error → sign-in fails; tokens NOT persisted; renderer surfaces error.
- Edge case (PKCE TTL): verifier inserted 11 minutes ago → background eviction timer removed it; callback arriving now is rejected as "no in-flight attempt."
- Edge case (PKCE cap): 5 in-flight attempts exist; `startOAuth` called → oldest evicted; new attempt accepted.
- Edge case (zeroize): `before-quit` event → verifier map entries' verifier strings are overwritten with random bytes before deletion (assertable via memory inspection in a test harness, or via tracking a tombstone).
- Edge case (sign-out, revoke fails): local storage cleared first, RevokeToken returns 500 three times, entry written to `pending-revocations.json`, `signedOut { ok: true, revokeFailed: true }` broadcast.
- Edge case (sign-out, network down): same as above; no infinite retry; bounded 5s budget.
- Edge case (next launch revocation drain): app starts with `pending-revocations.json` containing one entry → entry retried before any other startup work; on success, removed from file.
- Edge case (IPC guards): `startOAuth` invoked from `event.senderFrame.url = "https://evil"` → rejected by `assertSafeSenderFrame`; not attempted.
- Edge case (rate limit): `startOAuth` invoked twice within 2 seconds → second call rejected with rate-limit error.
- Error path: Cognito token endpoint returns 4xx → error surfaced to renderer via IPC.
- Error path: network failure during token exchange → error surfaced; retryable.
- Integration: full F1 flow (renderer click → main opens browser → callback → token exchange → renderer hydrates) works end-to-end against dev stage. **Precondition: U10 applied to the target stage.**
- Covers AE3 (R8/R9): cached-session restore on next launch via safeStorage uses refresh token without re-OAuth.

**Verification:**
- Manual: sign in via the desktop app against dev stage; renderer shows authenticated UI; `safeStorage` vault file exists on disk and decrypts to expected keys.
- Manual: quit + relaunch; sign-in is skipped; `AuthContext` hydrates from cached tokens within ~2 seconds.
- Manual: click "Sign Out"; renderer returns to `/sign-in`; vault file is removed; next launch requires OAuth.

---

### U9. Renderer OAuth callback route + AuthContext rewiring for desktop mode

**Goal:** Add a new TanStack Router file-route `apps/spaces/src/routes/auth/desktop-callback.tsx` that the desktop variant routes to after main signals "OAuth callback received." Pull pending callback via `bridge.consumePendingOAuth()` on mount. Subscribe to `bridge.onDeepLink` for warm-state callbacks. Route to `next` if main supplied one (always sourced from `bridge.consumePendingOAuth()`'s response, NEVER from the URL — defends against the CursorJack-style threat in which an attacker crafts a callback URL with an embedded `next` to phish). Default to `/new`.

**Requirements:** R8

**Dependencies:** U3, U7, U8, U17

**Files:**
- Create: `apps/spaces/src/routes/auth/desktop-callback.tsx`
- Modify: `apps/spaces/src/context/AuthContext.tsx` (subscribe to `bridge.onDeepLink` in desktop mode; trigger re-hydration on token-change events)
- Modify: `apps/spaces/src/routes/sign-in.tsx` (in desktop mode, call `bridge.startOAuth()` instead of `window.location.href = getGoogleSignInUrl()`)
- Test: `apps/spaces/src/routes/auth/desktop-callback.test.tsx`
- Test: `apps/spaces/src/context/AuthContext.test.tsx` (existing test — extend with desktop-mode subscription path)

**Approach:**
- The deep-link callback is handled by main process; renderer's role is to consume and rehydrate. Main fires `onDeepLink` event AFTER token exchange completes — by the time the renderer route mounts, tokens are already persisted in safeStorage and in main's in-memory cache.
- `desktop-callback.tsx` calls `bridge.consumePendingOAuth()` on mount. Returned shape is `{ code, state, next? } | null`. If non-null, calls `bridge.getSessionTokens()` to fetch tokens, triggers AuthContext re-hydration, then `useNavigate({ to: response.next ?? "/new" })`.
- **Critical: never source `next` from `window.location.search` or `useSearch()` on this route.** Any query parameter on the desktop callback URL is rejected by U7's URL allowlist anyway, but explicitly avoid the code path that would read query string here. `next` flows only via the main-process response. This defends against an attacker crafting `thinkwork://oauth/callback?code=...&state=...&next=//evil` even though the U7 allowlist already rejects extras — defense-in-depth.
- Strict-Mode double-mount guard: use a ref to ensure `consumePendingOAuth()` runs only once even if mount fires twice (React 19 dev mode).
- AuthContext desktop mode: hydrates from `bridge.getSessionTokens()` on EVERY mount (not just initial construction). Per the architecture review, this guards against a late-mount race where main broadcasts `tokensChanged` while no AuthContext instance is alive. The hydrate is sync from the renderer's perspective (returns the local cache value); a fire-and-forget IPC pull reconciles if the cache was constructed >1s ago.
- AuthContext also subscribes to `bridge.onDeepLink` for subsequent token changes after mount.
- Sign-in page: detection at click time — if `__DESKTOP_BUILD__` (set by U2), call `bridge.startOAuth({ next: nextParam })`; if web, navigate to hosted UI URL as today.

**Patterns to follow:**
- Existing `apps/spaces/src/routes/auth/callback.tsx` (the `exchanged` ref guard, the redirect-after-write pattern).
- Existing `apps/spaces/src/routes/_authed.tsx` (the `?next=` redirect pattern).

**Test scenarios:**
- Happy path: route mounts; `bridge.consumePendingOAuth()` returns `{ code, state }` (no `next`); navigation to `/new` fires.
- Happy path (with next): `consumePendingOAuth()` returns `{ code, state, next: "/automations/123" }`; navigation to `/automations/123` fires.
- Happy path: route mounts; `bridge.consumePendingOAuth()` returns null → no navigation; shows "no pending callback" state (could route to `/sign-in`).
- Edge case (security): the test deliberately injects a malicious URL with `?next=//evil.example` into `window.location.search`. The route MUST NOT navigate to `/evil.example`. The `next` value is ignored unless it comes from main's response.
- Edge case (security): the test injects `?next=javascript:alert(1)` into `window.location.search`. Same: ignored.
- Edge case: React Strict Mode double-mount → `consumePendingOAuth()` called exactly once (the ref guard works).
- Edge case: `bridge.consumePendingOAuth()` rejects (IPC failure) → user-visible error state, not silent failure.
- Happy path (AuthContext, initial): in desktop mode, initial `bridge.getSessionTokens()` returns tokens → AuthContext is authenticated.
- Happy path (AuthContext, re-mount): AuthContext unmounts and remounts (route transition) → fresh `bridge.getSessionTokens()` call → cache hydrated again → no missed-broadcast bug.
- Happy path (AuthContext, onDeepLink): a `onDeepLink` event fires → AuthContext re-hydrates from `bridge.getSessionTokens()`.
- Edge case (AuthContext, late mount race): main broadcasts `tokensChanged` BEFORE AuthContext mounts; AuthContext mounts and hydrates from `getSessionTokens()` → reflects the up-to-date tokens (no missed broadcast).
- Integration: full F1 flow (sign-in click → bridge.startOAuth → main browser flow → callback → desktop-callback route → AuthContext hydrated → /new) works end-to-end.
- Covers AE3 (R8): cached-session restore.

**Verification:**
- Manual: sign-in click on the desktop app opens system browser → completes OAuth → app receives callback → renderer routes to `/new`.
- AuthContext correctly reflects authenticated state without race conditions on cold start.

---

### U10. Terraform: extend `ThinkworkAdmin` callback URLs for desktop scheme

**Goal:** Add `thinkwork://oauth/callback` (and stage variants `thinkwork-dev://oauth/callback`, `thinkwork-canary://oauth/callback`) to the `ThinkworkAdmin` Cognito client's callback URLs. Apply via standard terraform deploy. **Hard prerequisite for U8** — without this applied to the target stage, Cognito's authorize endpoint returns `redirect_mismatch` and U8's integration test cannot pass. (Iframe-shell parent-origin allowlist is split off into U18; it gates U13's artifact rendering, not U8's OAuth.)

**Requirements:** R7 (origin)

**Dependencies:** None (can land in parallel with U2–U9 — but MUST be applied to the target stage before U8's integration test runs)

**Files:**
- Modify: `terraform/modules/foundation/cognito/variables.tf` (new `desktop_callback_urls` input, similar to existing `mobile_callback_urls`)
- Modify: `terraform/modules/foundation/cognito/main.tf` (thread `var.desktop_callback_urls` into `aws_cognito_user_pool_client.admin` callback_urls + logout_urls)
- Modify: `terraform/modules/thinkwork/main.tf` (line ~139-156: extend the `concat()` block to include desktop callbacks)

**Approach:**
- Default value for `desktop_callback_urls` matches the `mobile_callback_urls` convention: `["thinkwork://oauth/callback", "thinkwork-dev://oauth/callback", "thinkwork-canary://oauth/callback"]`.
- Logout URLs mirror callback shape.
- Apply order: this PR can merge before or after U2–U9 land; the desktop app can't authenticate against any stage until this terraform change is applied there.
- Pre-commit: `pnpm db:migrate-manual` is not relevant (no SQL migrations). `terraform fmt + terraform validate` from `terraform/examples/greenfield/`.

**Patterns to follow:**
- Existing `mobile_callback_urls` definition and threading in `terraform/modules/foundation/cognito/variables.tf:109-119` + `terraform/modules/foundation/cognito/main.tf:245-289` — port the same shape.
- `terraform/modules/thinkwork/main.tf:139-156` for the `concat()` block.

**Test scenarios:**
- Test expectation: none — terraform changes; verify via `terraform plan` showing only the expected diff.
- Manual verification (post-apply): `aws cognito-idp describe-user-pool-client --user-pool-id <DEV_POOL> --client-id <ADMIN_CLIENT>` shows the new callback URLs in the response.
- Manual verification: open the desktop app against dev stage; OAuth flow lands callback in the app without Cognito returning `redirect_mismatch`.

**Verification:**
- `terraform plan` against dev stage shows the expected callback URLs added; nothing else changes.
- Post-apply, the desktop OAuth flow completes successfully against dev.

---

### U11. Update state machine + electron-updater wiring + arch detection

**Goal:** Port t3code's pure-reducer update state machine to plain TypeScript (already Effect-free in t3code; just remove unused imports). Wire `electron-updater` events into the reducer. Push state to renderer via IPC. Include arch metadata (host vs app arch, Rosetta detection).

**Requirements:** R3, R16, R17

**Dependencies:** U2, U3

**Files:**
- Create: `apps/desktop/src/main/update-machine.ts` (pure reducers — port from `/tmp/desktop-scout/t3code/apps/desktop/src/updates/updateMachine.ts`)
- Create: `apps/desktop/src/main/updates.ts` (electron-updater wiring; subscribes to events; calls reducers; broadcasts to renderer)
- Create: `apps/desktop/src/main/telemetry.ts` (before/after install events; last-known-version comparison)
- Modify: `apps/desktop/src/main/ipc-handlers.ts` (register `getUpdateState`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, `onUpdateState`, `reportInstallOutcome`)
- Modify: `apps/desktop/src/main/index.ts` (call `updates.start()` after whenReady)
- Test: `apps/desktop/test/main/update-machine.test.ts`

**Approach:**
- Reducer signature: `(state, action) => state`. Action types match electron-updater events (`checking-for-update`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, `error`).
- State shape includes: `status`, `currentVersion`, `availableVersion`, `downloadedVersion`, `downloadPercent`, `hostArch`, `appArch`, `runningUnderArm64Translation`, `checkedAt`, `message`, `errorContext`, `canRetry`.
- `runningUnderArm64Translation` detected via `app.runningUnderARM64Translation` (Electron API) — set once at startup; surfaces in the UpdateState so the renderer can prompt to download the arm64 build.
- `autoUpdater.autoDownload = false` — user-gated.
- `autoUpdater.autoInstallOnAppQuit = true` — silent install on next quit if downloaded.
- Update check gated on `app.isPackaged` (Squirrel.Mac fails on unpackaged apps).
- Telemetry: emit `update.download_completed` IPC event before install with `{ version: nextVersion, channel, fromVersion: currentVersion }`. On next launch, compare `app.getVersion()` to `last-known-version.json` in `userData`; emit `update.install_completed` or `update.install_failed_or_skipped`.
- Channel: `autoUpdater.channel` derived from current version's SemVer suffix or from a user preference (stored in main-process settings).

**Patterns to follow:**
- `/tmp/desktop-scout/t3code/apps/desktop/src/updates/updateMachine.ts` (port verbatim, strip any unused imports).
- [electron-updater docs](https://www.electron.build/auto-update) for event names + flag semantics.

**Test scenarios:**
- Happy path (reducer): from `disabled`, action `checking-for-update` → state `checking`.
- Happy path (reducer): from `checking`, action `update-available` → state `available`, `availableVersion` set, `checkedAt` set.
- Happy path (reducer): from `available`, action `download-progress` → state `downloading`, `downloadPercent` updated.
- Happy path (reducer): from `downloading`, action `update-downloaded` → state `downloaded`, `downloadedVersion` set, `canRetry: true`.
- Edge case (reducer): from `downloading`, action `error` → state `available` (rollback to allow retry), `canRetry: true`, `errorContext: 'download'`.
- Edge case (reducer): from `downloading`, action `error` with no prior `availableVersion` → state `error`, `canRetry: false`.
- Happy path (telemetry): app version increased since last launch → `update.install_completed` event emitted.
- Edge case (telemetry): app version unchanged across multiple launches after a download was completed → `update.install_failed_or_skipped` event emitted.
- Edge case (arch detection): test with stubbed `app.runningUnderARM64Translation` → state correctly reflects `runningUnderArm64Translation`.
- Integration: full update cycle (mocked electron-updater) — check → available → download → downloaded → install — all events propagate to renderer state correctly.
- Covers AE6 (R16): update transitions push to renderer without polling.
- Covers AE7 (R17): Rosetta detection surfaces in state.

**Verification:**
- The reducer is pure (same inputs → same outputs; no side effects).
- The renderer receives state updates for every electron-updater event.
- Telemetry events emit at the right moments and contain the right fields.

---

### U12. Native menus + window chrome + sign-out + open-external

**Goal:** Install the native application menu with standard `File`, `Edit`, `View`, `Window`, `Help` entries plus a `Check for Updates` item and a `Sign Out` item. Apply hidden-inset titlebar on macOS with the configured traffic-light position. Wire `setWindowOpenHandler` and `will-navigate` to deny in-window navigation off `thinkwork://app/*` and route safe external URLs through `shell.openExternal` after allowlist validation. Intercept `page-title-updated` so the renderer can't spoof the OS-level window title.

**Requirements:** R5, R11, R12, R13

**Dependencies:** U2, U8

**Files:**
- Create: `apps/desktop/src/main/menus.ts`
- Modify: `apps/desktop/src/main/window.ts` (apply titlebar chrome, ready-to-show reveal, navigation handlers, page-title interception)
- Modify: `apps/desktop/src/main/ipc-handlers.ts` (register menu-driven commands)
- Modify: `apps/desktop/src/main/index.ts` (`menus.install()` in whenReady chain)
- Test: `apps/desktop/test/main/menus.test.ts`

**Approach:**
- Menu structure follows platform conventions: App menu on macOS (About, Preferences, Services, Hide, Quit), File/Edit/View/Window/Help.
- "Check for Updates" menu item fires `autoUpdater.checkForUpdates()` directly.
- "Sign Out" menu item fires the IPC `signOut` handler from U8 (which calls Cognito RevokeToken + clears storage + broadcasts to renderer).
- `View` menu includes the standard reload/devtools toggle (DevTools gated on dev builds; production hides it from the menu).
- Window chrome: `titleBarStyle: 'hiddenInset'` on macOS, `trafficLightPosition: { x: 14, y: 14 }`. Windows: `titleBarStyle: 'hidden'` + `titleBarOverlay` (post-launch when Windows ships).
- Show window only on `ready-to-show` with theme-matched `backgroundColor` set at construction — no white flash.
- `setWindowOpenHandler`: returns `{ action: 'deny' }` for every URL; for URLs passing the external-allowlist, fires `shell.openExternal` first.
- `will-navigate`: prevents in-window navigation off `thinkwork://app/*`; safe external URLs go through `shell.openExternal`.
- External URL allowlist (in `apps/desktop/src/main/url-allowlist.ts`): `^https://([a-z0-9-]+\.)*thinkwork\.ai$` + `^https://github\.com/thinkwork-ai/` (release notes, scoped to our org — NOT bare `github.com`, which would let a compromised renderer trigger malicious-OAuth-app consent screens against the user's authenticated GitHub session). **`accounts.google.com` is NOT in the allowlist:** the OAuth flow runs in the system browser via `shell.openExternal` and the entire Google interaction is over by the time the deep-link callback returns; allowlisting it serves no production purpose and would give a renderer-XSS attacker a high-reputation phishing surface.
- `page-title-updated`: `event.preventDefault()` on every fire so the renderer cannot change the OS-level title.

**Patterns to follow:**
- `/tmp/desktop-scout/t3code/apps/desktop/src/window/DesktopWindow.ts:147-291` for window factory + setWindowOpenHandler + page-title interception (rewrite without Effect; port the discipline).

**Test scenarios:**
- Happy path: menu installed; "Check for Updates" enabled; click triggers `autoUpdater.checkForUpdates()`.
- Happy path: "Sign Out" disabled when unauthenticated; enabled when authenticated.
- Happy path: `setWindowOpenHandler` invoked with a `https://thinkwork.ai/...` URL → `shell.openExternal` called; window.open denied.
- Happy path: `setWindowOpenHandler` invoked with `https://github.com/thinkwork-ai/thinkwork/releases/tag/desktop-v1.0.0` → `shell.openExternal` called; window.open denied.
- Edge case (security): `setWindowOpenHandler` invoked with `https://github.com/login/oauth/authorize?client_id=evil_app` → NOT in allowlist (scope is `^https://github\.com/thinkwork-ai/`); `shell.openExternal` NOT called.
- Edge case (security): `setWindowOpenHandler` invoked with `https://accounts.google.com/...` → NOT in allowlist; `shell.openExternal` NOT called. (The OAuth flow does NOT need this — it runs once via system browser at sign-in, not via renderer-initiated `window.open`.)
- Edge case: `setWindowOpenHandler` invoked with `https://malicious.example.com/` → NOT in allowlist; `shell.openExternal` NOT called.
- Edge case: `will-navigate` invoked with a navigation off `thinkwork://app/`; prevented; if external allowlist matches, `shell.openExternal` fired.
- Edge case: renderer calls `document.title = "hacker"`; `page-title-updated` fires; `event.preventDefault()` runs; the OS-level title remains the configured app name.
- Happy path: window created with `show: false`; `ready-to-show` fires; `window.show()` called; user sees the window without white flash.
- Covers AE1 (R5): external link → system browser, no Electron window.
- Covers AE5 (R11/R12): theme-matched chrome, no white flash, traffic lights at configured position.

**Verification:**
- Native menu visible on macOS with all expected items.
- External links open in the user's default browser, not in Electron.
- Window appears with theme-matched background; no white flash.
- Page title remains the configured app name regardless of renderer-side `document.title` writes.

---

### U13. Renderer-side desktop integrations (Notification API + update banner)

**Goal:** Renderer-side glue: detect `window.thinkworkBridge` to flip the app into desktop mode; render an update-state banner driven by `bridge.onUpdateState` subscription; emit in-app `Notification` API calls for agent-completion toasts; route the "Sign In" button through `bridge.startOAuth()` in desktop mode.

**Requirements:** R18

**Dependencies:** U3, U6, U8, U11

**Files:**
- Create: `apps/spaces/src/lib/desktop-detection.ts` (`isDesktop()` helper; one-line wrapper around `window.thinkworkBridge`)
- Create: `apps/spaces/src/components/update-banner.tsx` (subscribes to `bridge.onUpdateState`; surfaces available/downloading/downloaded states; "Restart to install" button → `bridge.installUpdate()`)
- Create: `apps/spaces/src/lib/desktop-notifications.ts` (thin wrapper around `Notification` API with permission check)
- Modify: `apps/spaces/src/routes/_authed/_shell/__layout.tsx` (or wherever the shell mounts; add `UpdateBanner`)
- Modify: `apps/spaces/src/routes/sign-in.tsx` (desktop branch → `bridge.startOAuth()`)
- Test: `apps/spaces/src/components/update-banner.test.tsx`
- Test: `apps/spaces/src/lib/desktop-notifications.test.ts`

**Approach:**
- `isDesktop()` returns boolean; cached after first call.
- Update banner only renders when `isDesktop() && updateState.status !== 'up-to-date' && updateState.status !== 'disabled'`. Otherwise nothing rendered.
- States surfaced: `available` ("Update v1.2.3 available — Download"), `downloading` ("Downloading 47%..."), `downloaded` ("Restart to install"), `error` ("Update failed: <message> — Retry"), Rosetta hint when `runningUnderArm64Translation === true && availableVersion has arm64 build`.
- Notification permission: request once on app mount (after sign-in) if `Notification.permission === 'default'`. If denied, fall back to in-app toast via existing `sonner` (already in apps/spaces deps).
- Sign-in detection: `if (isDesktop()) { await bridge.startOAuth(); }` else web flow.

**Patterns to follow:**
- Existing `apps/spaces/src/components/` shadcn pattern for the banner.
- `sonner` already used in apps/spaces for toasts.

**Test scenarios:**
- Happy path: in desktop mode with `updateState.status === 'available'`, banner renders with version and Download button.
- Happy path: clicking Download invokes `bridge.downloadUpdate()`.
- Happy path: in web mode, banner does NOT render.
- Edge case: `updateState.status === 'error'` and `canRetry === true` → banner shows Retry button.
- Edge case: `runningUnderArm64Translation === true` → banner shows the arm64-build hint.
- Happy path: notification permission granted; agent completes → native notification fires.
- Edge case: notification permission denied → falls back to `sonner` toast; no native notification fires.
- Edge case: in web mode, `desktop-notifications` is a no-op (does not request permission).
- Happy path: sign-in click in desktop mode calls `bridge.startOAuth()` not `window.location.href = getGoogleSignInUrl()`.

**Verification:**
- Update banner renders correctly in desktop mode against a mocked update state.
- Notification API permission is requested at the right moment; fallback to toast works.
- Sign-in routing differs between web and desktop modes.

---

### U14. electron-builder config + entitlements + hardened runtime + GitHub Releases publish

**Goal:** Author `electron-builder.yml` covering macOS DMG + zip targets (separate arm64 + x64), hardened runtime, App Store Connect API key notarization path, the entitlements plist, the App Sandbox / network entitlements required for V8 + outbound HTTPS, and the GitHub Releases publish block with `generateUpdatesFilesForAllChannels: true`.

**Requirements:** R1, R2, R3

**Dependencies:** U2

**Files:**
- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/build/entitlements.mac.plist`
- Create: `apps/desktop/build/icons/icon.icns` (production)
- Create: `apps/desktop/build/icons/icon-dev.icns` (dev variant)
- Create: `apps/desktop/build/icons/icon-canary.icns` (canary variant)
- Modify: `apps/desktop/package.json` (`productName` per stage resolved at build time; `electron-builder.yml` references it)
- Test: build-output validation in U15's CI workflow

**Approach:**
- `mac.target`: `[{ target: dmg, arch: [arm64, x64] }, { target: zip, arch: [arm64, x64] }]`. Zip is REQUIRED for electron-updater.
- `mac.category: public.app-category.productivity`
- `mac.hardenedRuntime: true`
- `mac.gatekeeperAssess: false` (we notarize ourselves)
- `mac.entitlements: build/entitlements.mac.plist`
- `mac.entitlementsInherit: build/entitlements.mac.plist`
- `mac.identity: "Developer ID Application: Thinkwork AI Inc (TEAMID)"` (resolved from env at build time; placeholder until Apple team identifier is finalized)
- `mac.notarize: true` (picks up App Store Connect API key env vars automatically with `@electron/notarize@3.x`)
- `publish: [{ provider: github, owner: <org>, repo: thinkwork, vPrefixedTagName: true, releaseType: release, publishAutoUpdate: true }]`. The release-trigger workflow runs on tags like `desktop-v1.0.0`.
- `generateUpdatesFilesForAllChannels: true` so prerelease versions publish `alpha-mac.yml` / `canary-mac.yml` alongside `latest-mac.yml`.
- Entitlements plist: `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory`, `com.apple.security.cs.allow-dyld-environment-variables`, `com.apple.security.network.client`, `com.apple.security.network.server`. These are required for V8 + outbound HTTPS + the localhost dev server (the latter only during dev).
- Per-stage `productName` resolved from a `BUILD_CHANNEL` env at build time: `ThinkWork Spaces` (stable), `ThinkWork Spaces (Canary)` (canary), `ThinkWork Spaces (Dev)` (dev). Icon also selected per channel.
- `appId` per channel to give each variant its own `userData` directory: `ai.thinkwork.spaces.desktop`, `ai.thinkwork.spaces.desktop.canary`, `ai.thinkwork.spaces.desktop.dev`.
- **Pin Apple Team Identifier as a compile-time constant** in `apps/desktop/src/main/index.ts` (e.g., `const EXPECTED_TEAM_ID = "TEAMID";`). On launch, verify the running app's code signature team ID matches via `app.getCodeSignature()` (or the platform's equivalent). If a rogue update ever ships with a different signing identity (cert leak + re-issuance to attacker), the app refuses to launch. Forward-only guard — first install can't self-verify, but it closes the post-install drift window. Pairs with the U15 SHA-256-at-second-domain mitigation as the v1 Tier-0 stopgap before v1.1 manifest signing lands.

**Patterns to follow:**
- [electron-builder mac docs](https://www.electron.build/mac).
- [@electron/notarize 3.x README](https://github.com/electron/notarize).

**Test scenarios:**
- Test expectation: none — config file; verify by running U15's GHA workflow against a `desktop-v0.0.0-test` tag on a branch and inspecting outputs.
- Manual verification: `pnpm --filter @thinkwork/desktop run package` (locally on a Mac) produces `dist/ThinkWork Spaces-1.0.0-arm64.dmg` + `.zip` + `.blockmap` + `latest-mac.yml`.
- Manual verification: `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/ThinkWork\ Spaces.app` returns valid.
- Manual verification: `spctl -a -t exec -vv dist/mac-arm64/ThinkWork\ Spaces.app` (run on the unsigned bundle pre-notarization) shows the expected rejection; after notarization, accepts.

**Verification:**
- Local Mac build produces correct artifacts.
- Code signature and notarization both validate via standard Apple tools.
- Each stage's build produces a distinct `productName` and `appId`.

---

### U15. `scripts/build-desktop.sh` + GitHub Actions release workflow on `macos-14`

**Goal:** A repo-root build script that mirrors `scripts/build-spaces.sh`'s env-injection pattern but extends to invoke electron-vite + electron-builder. A new GHA workflow on `macos-14` runner that runs on `desktop-v*` tag pushes: imports the signing certificate, runs build, signs + notarizes + publishes to GitHub Releases via electron-builder's `--publish always`.

**Requirements:** R1, R3

**Dependencies:** U2, U14

**Files:**
- Create: `scripts/build-desktop.sh` (env injection from terraform outputs + renderer build + electron-vite build + electron-builder)
- Create: `.github/workflows/release-desktop.yml` (macos-14 runner, tag-triggered, signed+notarized+published)
- Modify: `.github/workflows/release.yml` IF integration is preferred over a sibling workflow (resolved during implementation; default is sibling workflow to keep concerns separate)

**Approach:**
- `scripts/build-desktop.sh`: reads terraform outputs into env vars (same shape as `scripts/build-spaces.sh`); runs `pnpm --filter /spaces build` then `pnpm --filter @thinkwork/desktop run build` then `pnpm --filter @thinkwork/desktop exec electron-builder --mac --publish always`. Channel and version derived from CI env (`GITHUB_REF_NAME` parsing for tag `desktop-v1.2.3-canary.1` → channel `canary`, version `1.2.3-canary.1`).
- GHA workflow:
  - `on: push: tags: [desktop-v*]`
  - `runs-on: macos-14` (arm64 runner; Xcode 15+; notarytool pre-installed)
  - `timeout-minutes: 30`
  - **Preflight step: secrets check.** Before any build work, verify the required secrets are non-empty (`if [ -z "$MAC_CSC_LINK" ] || [ -z "$APPLE_API_KEY_P8_BASE64" ] || ... ]; then exit 1; fi`). Fails fast with a clear error if a secret was rotated incorrectly. Avoids burning 25 minutes only to fail at notarytool.
  - Steps: checkout → pnpm setup → Node 22 setup → `pnpm install --frozen-lockfile` → preflight secrets check → import signing cert from `MAC_CSC_LINK` + `MAC_CSC_KEY_PASSWORD` GH secrets into a temp keychain → run `scripts/build-desktop.sh` with env: `APPLE_API_KEY_ID`, `APPLE_API_KEY_ISSUER`, `APPLE_API_KEY` (path to .p8 written from `APPLE_API_KEY_P8_BASE64` secret), `APPLE_TEAM_ID`, `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.
  - **Post-publish step: SHA-256 mirror.** After electron-builder publishes the DMG to GitHub Releases, compute `shasum -a 256` of each DMG and publish them as a separate artifact to `docs.thinkwork.ai/releases/<version>.sha256` (a different infrastructure surface — Cloudflare-fronted docs site with a different publish token). A supply-chain attacker who steals the GH publish token still cannot update the SHA at docs.thinkwork.ai without also compromising Cloudflare. Document the manual verification command in U16's README: `shasum -a 256 ThinkWork\ Spaces-1.0.0-arm64.dmg | grep -f <(curl https://docs.thinkwork.ai/releases/1.0.0.sha256)`. This is the Tier-0 stopgap before manifest signing lands in v1.1.
  - GH_TOKEN uses the built-in `GITHUB_TOKEN` for v1; transition to a dedicated GitHub App OIDC-bound token in a follow-up (Deferred to Follow-Up Work).
- The CI workflow uses `concurrency: { group: release-desktop-${{ github.ref }}, cancel-in-progress: false }` to prevent overlapping releases on the same tag.
- Apple secrets convention (matches the `rotate-api-auth-secret-2026-04-24` runbook shape): `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_KEY_ISSUER`, `APPLE_TEAM_ID`, `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` — all in GH repo secrets, rotated quarterly.
- **Precondition for end-to-end verification:** U10 must be applied to the target stage. The workflow itself doesn't depend on terraform state, but the produced DMG won't authenticate until callback URLs are configured. Document in U16 runbook.

**Patterns to follow:**
- `scripts/build-spaces.sh` for env-injection shape + terraform-outputs reading.
- `.github/workflows/release.yml` for the existing release-pipeline conventions in this repo.
- [Simon Willison's GHA recipe for sign+notarize+publish Electron on macOS](https://til.simonwillison.net/electron/sign-notarize-electron-macos).

**Test scenarios:**
- Test expectation: build artifacts produced and uploaded to GitHub Releases — verified by tagging `desktop-v0.0.1-test` on a fork or branch and observing the workflow output.
- Edge case: tag with a `-canary.N` suffix → `electron-updater` publishes `canary-mac.yml` in addition to `latest-mac.yml`.
- Edge case: notarization fails (Apple API down) → workflow fails clearly; no partial release published.
- Edge case: signing cert import fails → workflow fails clearly; no build artifacts produced.
- Manual verification: download the DMG from a real GitHub Release, open on a clean Mac, Gatekeeper accepts (notarization is stapled).

**Verification:**
- Tagging `desktop-v0.0.1-test` on a feature branch triggers the workflow; it completes successfully; a GitHub Release is created with the DMG, zip, blockmap, and `latest-mac.yml`.
- The downloaded DMG installs cleanly and the resulting app passes Gatekeeper.

---

### U16. Stage-specific `productName` + `userData` isolation + dev-loop README + runbooks

**Goal:** Lock in the per-stage isolation contract (each variant has its own `productName`, `appId`, `userData` dir, dock icon, and URL scheme). Author `apps/desktop/README.md` covering: dev bootstrap, tsbuildinfo incantation, the OAuth-callback testing flow, the per-stage scheme installation gotcha, the Linux safeStorage fallback behavior. Author the first `docs/solutions/` runbook entries for Cognito callback updates and Apple credentials rotation.

**Requirements:** R2

**Dependencies:** U2, U10, U14, U15

**Files:**
- Modify: `apps/desktop/electron-builder.yml` (confirm `appId` and `productName` resolution per `BUILD_CHANNEL`)
- Create: `apps/desktop/README.md` (dev bootstrap + production install instructions + Linux fallback notes)
- Create: `docs/solutions/runbooks/update-cognito-callback-urls-2026-05-NN.md` (the playbook from learnings #2's pattern, adapted for Cognito URL updates)
- Create: `docs/solutions/runbooks/rotate-apple-developer-credentials-2026-05-NN.md` (using `rotate-api-auth-secret-2026-04-24` as the template)
- Modify: root `README.md` (add a brief pointer to the new desktop app under "Apps")

**Approach:**
- `appId` per channel: `ai.thinkwork.spaces.desktop` (stable), `ai.thinkwork.spaces.desktop.canary`, `ai.thinkwork.spaces.desktop.dev`. Distinct `appId` is what gives each variant its own macOS `userData` dir (`~/Library/Application Support/<productName>/`).
- README sections: "Local development" (pnpm install + tsbuildinfo bootstrap + `pnpm --filter @thinkwork/desktop dev`), "Building locally" (`pnpm --filter @thinkwork/desktop run package`), "Production install" (download DMG from Releases, drag to Applications), "Linux fallback caveat" (in-memory only when `safeStorage` is unavailable), "OAuth testing in dev" (use the `thinkwork-dev://` scheme; install only one stage at a time during dev to avoid scheme collision), "Channel selection" (how to opt into canary).
- Runbook: Cognito callback URL update — snapshot existing client → mutate via Terraform variable → `terraform apply` → verify with `describe-user-pool-client`.
- Runbook: Apple credentials rotation — `gh secret set APPLE_API_KEY_P8_BASE64` + `gh secret set APPLE_API_KEY_ID` + `gh secret set APPLE_API_KEY_ISSUER` + verify next release workflow run succeeds.

**Patterns to follow:**
- `docs/solutions/security/rotate-api-auth-secret-2026-04-24.md` as the runbook template.
- Existing `apps/spaces/README.md`, `apps/admin/README.md` for README shape conventions.

**Test scenarios:**
- Test expectation: docs; verify by reading them and confirming the procedures match the actual implementation.
- Manual verification (per-stage isolation): install both stable and dev DMGs on the same Mac; sign in to each independently; confirm tokens don't bleed across.

**Verification:**
- README is comprehensive enough that a teammate could clone, bootstrap, and run the desktop app without asking questions.
- Runbooks match the actual operational steps and reference the real secrets and variables.
- Per-stage installs coexist without state collision.

---

### U17. Desktop variant TokenStorage + main-process auth-bridge

**Goal:** Add the desktop-side companions to U6's `TokenStorage` interface. The renderer constructs `DesktopBridgeTokenStorage` (proxies sync calls into the in-renderer cache + fires fire-and-forget IPC for writes; hydrates on EVERY mount). Main owns a `CognitoUserPool` instance constructed with the safeStorage-backed `ICognitoStorage` from U5, plus IPC handlers for `getSessionTokens`, `signOut`, `consumePendingOAuth` registered through U3's `assertSafeSenderFrame` + `rateLimit` guards. (Split off from the original U6 per the architecture review; U6 stays as the web-only refactor that ships green for web users in isolation.)

**Requirements:** R8, R10, R24

**Dependencies:** U3, U5, U6

**Files:**
- Create: `apps/spaces/src/lib/token-storage/desktop-bridge.ts` (desktop variant; uses `window.thinkworkBridge`; hydrates on every mount)
- Modify: `apps/spaces/src/main.tsx` (add the `__DESKTOP_BUILD__` branch: `__DESKTOP_BUILD__ ? new DesktopBridgeTokenStorage() : new LocalStorageTokenStorage()`)
- Create: `apps/desktop/src/main/auth-bridge.ts` (registers IPC handlers; owns the `CognitoUserPool` instance with safeStorage backend; implements the token broadcast)
- Modify: `apps/desktop/src/main/ipc-handlers.ts` (wire auth-bridge handlers into the central registration)
- Test: `apps/spaces/src/lib/token-storage/desktop-bridge.test.ts` (mock `window.thinkworkBridge`)
- Test: `apps/desktop/test/main/auth-bridge.test.ts`

**Approach:**
- `DesktopBridgeTokenStorage` maintains a small in-renderer `Map<string, string>` cache of token state, populated on EVERY mount from `bridge.getSessionTokens()`. Per the architecture review, hydrate-on-every-mount (not just initial construction) is the invariant that defends against the late-mount race in which main broadcasts `tokensChanged` while no AuthContext instance is alive.
- Sync `getItem` reads from the cache. Sync `setItem` updates the cache AND fires a fire-and-forget IPC to main (main does the real persistence).
- The desktop renderer does NOT do the refresh-token exchange itself. Main owns `CognitoUserPool` with the safeStorage backend from U5. The renderer just observes the resulting tokens.
- **Monotonic version counter on token state** (in main): each token update increments a version number; broadcasts include the version. Renderer detects missed broadcasts by comparing versions on each hydrate — if the local cache's last-seen version trails main's current version, the renderer pulls fresh tokens to catch up.
- Identity resolution in main: after token exchange, `meUser` → `users.id` → write storage keys with that id as username. Never raw Cognito `sub` (learning `oauth-authorize-wrong-user-id-binding-2026-04-21`).
- IPC handlers wrap with `assertSafeSenderFrame` (U3) + `rateLimit` (`signOut` at 1/2s).

**Patterns to follow:**
- U6's `TokenStorage` interface — desktop variant honors the same shape.
- `feedback_mobile_cognito_sync_invariant` memory — hydration must be sync; no callback drift.
- `feedback_completion_callback_snapshot_pattern` — main snapshots env at whenReady, threads through.

**Test scenarios:**
- Happy path: renderer mount → `bridge.getSessionTokens()` IPC → desktop cache populated → AuthContext hydrates.
- Happy path: main process receives token update from Cognito refresh → broadcasts `tokensChanged` (with version) to renderer → desktop cache + AuthContext re-hydrate.
- Happy path (hydrate-on-mount): AuthContext unmounts and remounts → fresh `getSessionTokens()` call → cache refreshed → up-to-date with main's state.
- Edge case (late-mount race): main broadcasts `tokensChanged` while AuthContext is unmounted → on next mount, `getSessionTokens()` returns the latest state → no missed update.
- Edge case (version mismatch detection): renderer hydrates, gets version 5; later observes a `tokensChanged` event with version 7; falls back to `getSessionTokens()` to catch up (a version 6 broadcast was missed).
- Edge case: `bridge.getSessionTokens()` returns null → AuthContext stays in unauthenticated state → user is routed to `/sign-in`.
- Edge case: bridge IPC fails (main process crashed) → AuthContext surfaces error to UI, not silent failure.
- Edge case (IPC guards): IPC handler invoked from `event.senderFrame.url = "https://evil"` → rejected by `assertSafeSenderFrame`.
- Integration: main owns `CognitoUserPool` with safeStorage backend; renderer's `TokenStorage` interface receives identical key shapes to the web variant.

**Verification:**
- `apps/desktop` build can sign in, receive tokens via IPC, and the renderer's `AuthContext` reflects the tokens.
- Cache stays consistent across renderer mount/unmount cycles.
- Monotonic version counter correctly detects missed broadcasts.

---

### U18. Terraform: iframe-shell parent-origin allowlist extension

**Goal:** Add `thinkwork://app` (and stage variants `thinkwork-dev://app`, `thinkwork-canary://app`) to `var.computer_sandbox_allowed_parent_origins` so the iframe-shell at `sandbox.thinkwork.ai` accepts the desktop renderer as a valid parent. (Split off from the original U10 per the architecture review; can ship later than U10 because it gates iframe-shell artifact rendering under desktop, not the OAuth flow.)

**Requirements:** R19 (origin)

**Dependencies:** None (can land after U13 — iframe artifacts don't render under desktop until U13 lands)

**Files:**
- Modify: `terraform/modules/thinkwork/main.tf` (extend `var.computer_sandbox_allowed_parent_origins` to include the three desktop origins)

**Approach:**
- Electron resolves `new URL("thinkwork://app").origin` to `"thinkwork://app"` — verify the exact string during application (Electron version differences can affect the trailing slash or empty pathname behavior).
- `var.computer_sandbox_allowed_parent_origins` already accepts a list; this is purely additive — no existing origins removed.

**Patterns to follow:**
- Existing list shape in `terraform/modules/thinkwork/main.tf`.

**Test scenarios:**
- Test expectation: none — terraform changes; verify via `terraform plan` diff.
- Manual verification (post-apply): an iframe-shell artifact loaded from the desktop renderer passes the origin check in `apps/spaces/src/iframe-shell/iframe-protocol.ts` against `__ALLOWED_PARENT_ORIGINS__`.

**Verification:**
- `terraform plan` against dev stage shows the expected origins added; nothing else changes.
- Post-apply, desktop-loaded iframe artifacts render correctly.

---

## System-Wide Impact

- **Interaction graph:**
  - `apps/spaces/src/lib/auth.ts` becomes pluggable behind `TokenStorage`. Every consumer of `auth.ts` continues to work in web mode without change; desktop mode hydrates from IPC instead.
  - `apps/spaces/src/main.tsx` gains a `__DESKTOP_BUILD__` (build-time define from electron-vite renderer override, NOT a runtime check) branch that chooses the TokenStorage variant. This branch fires before AuthProvider mounts. The web build tree-shakes the desktop variant entirely.
  - `apps/spaces/src/routes/sign-in.tsx` gains a `__DESKTOP_BUILD__` branch: in desktop mode, call `bridge.startOAuth({ next })` instead of navigating to the hosted UI URL.
  - `terraform/modules/foundation/cognito/main.tf` + `terraform/modules/thinkwork/main.tf` gain new callback URLs on the `ThinkworkAdmin` client. Existing web flow continues to work.
  - `var.computer_sandbox_allowed_parent_origins` gains three desktop origins. Existing web parent origin continues to work.
- **Error propagation:**
  - Main → renderer: every IPC handler returns a tagged Result `{ ok: true, value } | { ok: false, error }`. Renderer surfaces failures via AuthContext error state or update-banner error state.
  - Renderer → main: IPC payloads validated by Zod at the boundary; validation failures throw and surface as IPC errors.
  - Cognito refresh-token expired: surfaced through AuthContext → user routed to `/sign-in` → OAuth flow restarts.
  - Sign-out with revocation failure: local cleared first, `{ ok: true, revokeFailed: true }` returned so the renderer can render a "revoke pending — retry on next launch" notice. Pending-revocation queue persisted to disk; drained on next startup before any other work.
- **State lifecycle risks:**
  - safeStorage debounced flush could lose unflushed state if main crashes within the 100ms window. Mitigation: on `before-quit`, flush synchronously (skip debounce).
  - Pending OAuth callback URL could be dropped if main crashes between `open-url` and IPC drain. Mitigation: pending-URL queue persists in memory only — if main crashes, the user retries sign-in.
  - Update download could be interrupted by quit. Mitigation: electron-updater resumes from blockmap on next launch.
  - PKCE verifier could leak via main-process crash dump. Mitigation: verifier is short-lived (10-min TTL, deleted after token exchange, zeroized on `before-quit`); not persisted.
  - **Renderer cache vs IPC broadcast race during mount transitions:** If main broadcasts `tokensChanged` while no AuthContext instance is alive (between route transitions, Strict-Mode double-mount, HMR), the broadcast is dropped. Mitigation: `DesktopBridgeTokenStorage` hydrates on EVERY mount via `bridge.getSessionTokens()`, not just initial construction. Plus a monotonic version counter on token state lets the renderer detect missed broadcasts after the fact.
  - **In-flight GraphQL mutation when sign-out fires** (F5): mutation runs with a token main has just told Cognito to revoke. Renderer aborts in-flight urql operations on `signedOut` event before navigating to `/sign-in`.
- **API surface parity:**
  - `apps/mobile` is the other surface with custom-scheme OAuth. The desktop variant should not diverge in shape — both use `thinkwork://` (or stage variants) and both go through the same Cognito hosted UI. Adding a desktop callback URL does NOT affect mobile.
  - The web flow is unchanged in observable behavior — the TokenStorage refactor preserves the existing localStorage key layout.
- **Integration coverage:**
  - F1 (first-launch OAuth) crosses renderer → main → system browser → Cognito → main → renderer. Manual smoke test in U8 + U9.
  - F2 (cold launch with cached session) crosses main → safeStorage → renderer. Manual smoke test + characterization test in U6.
  - F3 (autoupdate) crosses main → GitHub Releases → main → renderer. Manual smoke test + mocked integration test in U11.
  - **F4 (token refresh during in-flight AppSync subscription):** Main owns the refresh exchange (U17). When access token rotates mid-subscription, the renderer's existing wss connection holds the old token. Contract: the renderer subscribes to `bridge.onTokensChanged` and reconnects AppSync subscriptions on every `tokensChanged` broadcast. Implementation seam lives in `apps/spaces/src/lib/use-chat-appsync-transport.ts`. Pre-launch validation is the "AppSync subscription longevity over long-lived desktop sessions" brainstorm in Deferred to Follow-Up Work.
  - **F5 (sign-out broadcast race):** Sign-out (U8) clears local first, revokes async, broadcasts `signedOut`. Contract: the renderer aborts in-flight urql operations on `signedOut` event, then navigates to `/sign-in`. Prevents in-flight mutations from running with a just-revoked token.
  - **F6 (update install with unsaved renderer state):** `quitAndInstall` (U11) triggers immediate process exit. Contract: `installUpdate` IPC handler does a `beforeInstall` round-trip to the renderer asking "any unsaved state?" — defaults to install-on-confirm. Renderer surveys urql cache for unwritten mutations + open editor surfaces for unsaved drafts.
- **Unchanged invariants:**
  - `apps/spaces/vite.config.ts` is untouched (R20). The `__DESKTOP_BUILD__` define is injected via electron-vite's renderer override config, not by modifying the web Vite config.
  - `apps/spaces/vite.iframe-shell.config.ts` is untouched.
  - The web app's sign-in / sign-out / session-restore flows continue to work identically after the auth.ts refactor (characterization test in U6 enforces this).
  - The existing `ThinkworkAdmin` Cognito client is extended (added callbacks), not replaced.
  - The existing `apps/spaces/src/iframe-shell/iframe-shell.html` CSP is untouched — only the host-bundle CSP is new.
  - **The host-bundle CSP is stricter than the deployed web CSP** by design — the desktop is a closed surface, not a CDN-fronted SPA, so it doesn't need to inherit web's looser CSP.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OAuth deep-link cold-start delivery fails on macOS Sonoma+ | Medium | High | U1 spike validates before plan commits. Buffering pattern is well-documented; t3code doesn't implement this but the brainstorm + research call it out explicitly. |
| `amazon-cognito-identity-js` Storage refactor breaks existing web auth | Medium | High | Characterization test in U6 covers the existing flow before refactor. TokenStorage interface preserves the localStorage key layout exactly; only the call-site abstraction changes. |
| Cognito client refresh-token validity (30d) causes friction for desktop users | Low | Low | Documented; raised to follow-up work. v1 ships with 30d; raise to 90d (or mint `ThinkworkDesktop` client) if reports surface. |
| Per-stage URL scheme collision on macOS LSHandler | Low | Medium | Distinct schemes per stage (`thinkwork`, `thinkwork-dev`, `thinkwork-canary`) avoids collision by design. Documented in U16 README. |
| Apple notarization fails or times out in CI | Medium | Medium | Use App Store Connect API key path (key doesn't expire); GHA timeout 30m; manual fallback runbook for notarytool submit. |
| GitHub Releases publish token compromise (supply-chain) | Low | Critical | v1 uses built-in `GITHUB_TOKEN`. Follow-up: GitHub App OIDC-bound token. Manifest signing (Doyensec SafeUpdater) queued for v1.1. Quarterly rotation. |
| Squirrel.Mac team-identifier rotation breaks autoupdate for existing users | Low | High | Document the constraint in U16 runbook; verify in CI that the identity matches across builds. If team identifier ever rotates, plan a forced reinstall path (out of scope for v1). |
| iframe-shell parent-origin allowlist mis-extension breaks artifact rendering | Low | Medium | U10 terraform change adds origins additively; existing web origin continues to work; test against dev stage before merging. |
| Linux `safeStorage` `basic_text` fallback ships unintentionally to users | Low | Low | v1 is macOS-only; Linux is out of scope. If a Linux user runs an unsupported build, in-memory mode + UI banner is the correct degraded behavior. |
| Differential-update blockmap corruption breaks updates | Low | Medium | Differential updates explicitly disabled in v1 (Deferred to Follow-Up Work). Full-download model is reliable. |
| New macOS GHA pipeline introduces ops cost without owner | Medium | Medium | U16 runbooks formalize ownership; secrets rotation is on a quarterly calendar; pipeline is gated on tag push (no continuous cost). |
| `apps/spaces/src/lib/auth.ts` refactor introduces regression in web users | Low | High | U6 starts with a characterization test of the existing flow; refactor preserves the localStorage key layout; web build is functionally unchanged. Smoke against dev stage before merging the auth refactor PR. |
| `safeStorage` vault readable by other apps under the same signing identity (macOS) or same OS user (Windows/Linux) | Low (today) → Medium when a second ThinkWork-signed macOS app ships | Medium (refresh token theft → full account takeover until Cognito session expiry) | Documented in U16 README; do not ship a second ThinkWork-signed macOS app without an explicit decision on vault sharing; consider `kSecAttrAccessGroup` for cross-app isolation if needed post-v1. Cite: Apple Developer Documentation, "Sharing Access to Keychain Items Among a Collection of Apps." |
| Sign-out RevokeToken failure leaves a valid refresh token at Cognito after user clears local storage (stolen-device scenario) | Medium | Medium (window between sign-out and token expiry; 30d default validity) | U8 explicit failure contract: clear local first, retry revoke with 5s budget, persist failed-revocation queue to disk, drain on next launch, surface "revoke pending" notice in renderer. RFC 7009 §2.1 compliant. |
| Renderer XSS opens malicious `https://github.com/login/oauth/authorize?client_id=evil_app` via `shell.openExternal` (bare `github.com` allowlist) | Low | Medium | U12 allowlist tightened to `^https://github\.com/thinkwork-ai/` — only our org's URLs accepted. `accounts.google.com` removed entirely (not needed post-OAuth). |
| CSP `wss://*.appsync-realtime-api.us-east-1.amazonaws.com` wildcard would match any AWS account's AppSync in the region | Low | High (XSS could exfiltrate session via wss to attacker-controlled AppSync) | U4 CSP pins specific `<APPSYNC_API_ID>` from terraform outputs at build time — no wildcard. |
| PKCE verifier accumulates in main-process memory from abandoned sign-in attempts; leaks via crash dump | Low | Low (verifier alone is not credential-equivalent without the code) | U8 10-min TTL eviction + 5-attempt cap + zeroize-on-quit. |
| Late-mount IPC broadcast race drops `tokensChanged` event while AuthContext is unmounted | Medium | Low-Medium (renderer shows stale tokens until next IPC) | U17 hydrate-on-every-mount + monotonic version counter for missed-broadcast detection. |
| GitHub Releases publish token compromised; manifest signing not yet in place | Low | Critical (forced malicious update to all users) | v1 uses built-in `GITHUB_TOKEN`. Tier-0 stopgap: SHA-256 mirror published to docs.thinkwork.ai (different infrastructure surface). Apple Team ID pinned in main + verified on launch. v1.1: Doyensec SafeUpdater manifest signing (Deferred to Follow-Up Work). |
| Per-stage URL scheme stale handler from old dev install captures prod callbacks | Low | Medium (callback dropped or routed wrong) | Distinct schemes per stage prevent this; U16 README explicitly instructs uninstalling stage variants. |

---

## Phased Delivery

The plan ships in five sequenced phases after the gating spike. Earlier PRs land independently of later ones where dependencies permit. U6 (web-only auth.ts refactor) is structured to ship green to web users in isolation before any desktop coupling exists. U10 (Cognito callbacks) is a hard prerequisite for U8's end-to-end OAuth integration test against any stage. U14 + U15 ship as a single PR (or as ship-inert U14 + flip in U15 per `feedback_ship_inert_pattern`) — they cannot be exercised independently.

### Phase 0 — OAuth cold-start spike (gating, no PR to main)
- U1: validate the highest-risk path before committing to the rest of the work.

### Phase 1 — Foundation (parallel-friendly)
- U2: scaffold `apps/desktop/` + electron-vite config with `__DESKTOP_BUILD__` define.
- U3: `packages/desktop-ipc/` shared contracts + `assertSafeSenderFrame` + `rateLimit` helpers.
- U4: custom `thinkwork://` protocol handler with pinned CSP directives.
- U5: `safeStorage`-backed Cognito storage backend.
- U6: web-only auth.ts refactor to TokenStorage interface + characterization test. **Ships green to web users in isolation — no desktop dependency.**
- U10: Cognito callback URLs in Terraform. **Hard prerequisite for U8** — must be applied to target stage before U8 integration test runs.

### Phase 2 — Auth flow (depends on Phase 1)
- U7: deep-link handler + URL allowlist + single-instance lock.
- U17: desktop variant TokenStorage + main auth-bridge. (Depends on U3, U5, U6.)
- U8: OAuth flow with PKCE + TTL + cap + zeroize + state nonce + RevokeToken failure contract. (Depends on U5, U7, U10, U17.)
- U9: renderer OAuth callback route + AuthContext rewiring with hydrate-on-mount. (Depends on U3, U7, U8, U17.)

### Phase 3 — Update + Native UX
- U11: update state machine + electron-updater wiring + arch detection + install telemetry.
- U12: native menus + window chrome + tightened URL allowlist + open-external + page-title interception.
- U13: renderer-side desktop integrations (update banner + Notification API).

### Phase 4 — Build + Release (single PR or ship-inert U14 + flip in U15)
- U14: electron-builder config + entitlements + Apple Team ID pin on launch.
- U15: build script + GHA `release-desktop.yml` workflow + secrets preflight + SHA-256 mirror to docs.thinkwork.ai.
- U18: iframe-shell parent-origin allowlist extension in Terraform (can ship anytime after U13 starts producing artifact-rendering need).

### Phase 5 — Docs + Stage isolation
- U16: per-stage isolation + README + first `docs/solutions/` runbook entries (Cognito callback updates + Apple credentials rotation + SHA-256 verification command).

---

## Documentation / Operational Notes

- **Documentation:**
  - `apps/desktop/README.md` (U16) covers dev bootstrap, tsbuildinfo incantation, OAuth testing in dev, per-stage scheme installation gotcha, Linux fallback.
  - Root `README.md` (U16) adds a one-line pointer to the new desktop app under "Apps."
  - `docs/solutions/runbooks/update-cognito-callback-urls-2026-05-NN.md` (U16).
  - `docs/solutions/runbooks/rotate-apple-developer-credentials-2026-05-NN.md` (U16).
  - The OAuth-spike output (U1) becomes a `docs/solutions/spikes/` entry capturing the chosen buffering pattern + the 7-scenario validation matrix.

- **Operational:**
  - GitHub Actions secrets to provision before U15 can run: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_KEY_ISSUER`, `APPLE_TEAM_ID`. Rotated quarterly per the Apple-credentials runbook.
  - First release: tag `desktop-v0.1.0` (or whatever versioning convention is chosen). The GHA workflow handles the rest.
  - Pre-launch: run a release-build against dev stage, install on three different Mac models (Apple Silicon, Intel under Rosetta, Apple Silicon native), validate F1 + F2 + F3 flows end-to-end.
  - Rollback: forward-only by default; recovery from a bad release is "publish a patch immediately" (per electron-updater convention). Documented in U16.
  - Monitoring: update telemetry events (U11) flow into the same observability surface as the rest of the app; no new infrastructure.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md](../brainstorms/2026-05-20-computer-electron-desktop-shell-requirements.md)
- Related code:
  - `apps/spaces/src/lib/auth.ts`
  - `apps/spaces/src/routes/auth/callback.tsx`
  - `apps/spaces/src/routes/sign-in.tsx`
  - `apps/spaces/src/main.tsx`
  - `apps/spaces/vite.config.ts`
  - `terraform/modules/foundation/cognito/main.tf` (lines 201-289)
  - `terraform/modules/thinkwork/main.tf` (lines 139-156)
  - `scripts/build-spaces.sh`
  - `.github/workflows/release.yml`
- Related precedents (t3code reference impl, NOT copied wholesale):
  - `/tmp/desktop-scout/t3code/apps/desktop/src/electron/ElectronProtocol.ts`
  - `/tmp/desktop-scout/t3code/apps/desktop/src/preload.ts`
  - `/tmp/desktop-scout/t3code/apps/desktop/src/updates/updateMachine.ts`
- External docs (full list under Context & Research → External References):
  - [Electron 42 deep-links tutorial](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
  - [Electron `protocol.handle`](https://www.electronjs.org/docs/latest/api/protocol)
  - [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage)
  - [electron-vite 5.0 config](https://electron-vite.org/config/)
  - [electron-builder mac](https://www.electron.build/mac)
  - [electron-builder release channels](https://www.electron.build/tutorials/release-using-channels.html)
  - [@electron/notarize](https://github.com/electron/notarize)
  - [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/rfc9700/)
  - [Cognito PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html)
  - [Doyensec — Secure Electron Auto-Updater](https://blog.doyensec.com/2026/02/16/electron-safe-updater.html)
  - [Proofpoint — CursorJack](https://www.proofpoint.com/us/blog/threat-insight/cursorjack-weaponizing-deeplinks-exploit-cursor-ide)
- Related institutional learnings:
  - `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`
  - `docs/solutions/security/rotate-api-auth-secret-2026-04-24.md`
  - `docs/solutions/integration-issues/flue-supply-chain-integrity-2026-05-04.md`
  - `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md`
  - `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`
