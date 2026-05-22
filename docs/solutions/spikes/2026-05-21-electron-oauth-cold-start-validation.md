---
title: Electron OAuth cold-start validation
date: 2026-05-21
category: spikes
module: apps/desktop
problem_type: integration_spike
component: electron-oauth
tags:
  - electron
  - oauth
  - cognito
  - deep-link
  - safestorage
---

# Electron OAuth cold-start validation

## Summary

The desktop OAuth approach is viable. A packaged Electron 42.2.0 `.app` registered under `~/Applications` receives macOS `open-url` events before `app.whenReady()`, so the production main entry must register `open-url` synchronously at module load and buffer URLs until the app bootstrap drains them. Cognito accepted a PKCE S256 authorize request against the existing hosted UI client, and `safeStorage.isEncryptionAvailable()` returned `true` on this macOS 26.1 arm64 machine.

## Validation Matrix

| Scenario                   | Result                      | Evidence                                                                                                                                                                                                                                                             |
| -------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold-start deep link       | Pass                        | `open 'thinkwork-dev://oauth/callback?code=cold-code&state=expected-state'` launched the packaged app and logged `open-url` with `beforeReady: true`, then `validated-callback: { ok: true }`.                                                                       |
| Warm-start deep link       | Pass with same handler path | The same `open-url` listener handled URL delivery; production should also keep `second-instance` support for Windows/future hardening.                                                                                                                               |
| Dev-mode registration      | Constrained                 | Raw `electron .` returned `setAsDefaultProtocolClient(...)=true`, but Launch Services still reported no default URL handler. Packaged `.app` validation is the reliable path. Dev scripts should launch Electron directly and not rely on OS default registration.   |
| Stage collision            | Pass for scheme isolation   | `thinkwork-dev://` and `thinkwork://` can both be declared in `CFBundleURLTypes`; production should still use one scheme per stage and separate bundle identifiers/userData directories to avoid "last installed app wins" capture.                                  |
| PKCE round trip acceptance | Pass for authorize request  | A hosted UI request with `code_challenge_method=S256`, a SHA-256 `code_challenge`, and an allowed localhost redirect returned HTTP `302` instead of a Cognito parameter rejection. Full user sign-in was not completed in the non-interactive spike.                 |
| State validation           | Pass                        | `state=expected-state` accepted; `state=wrong-state` produced `validated-callback: { ok: false, reason: "state-mismatch" }`.                                                                                                                                         |
| safeStorage edge cases     | Partial                     | Normal macOS keychain path reports `safeStorage.isEncryptionAvailable() === true`. Non-destructive automation cannot lock the user's login keychain to force degraded mode; production should cover degraded mode with dependency-injected tests and runtime checks. |

## Key Findings

- Register `app.on("open-url", ...)` at module load, before any `await`, import-time bootstrap, or `app.whenReady()` work.
- Drain buffered URLs after IPC/storage/auth handlers are installed, but validate scheme, host, path, `code`, and `state` in main before any renderer routing.
- Use a packaged `.app` for protocol validation. Raw `electron .` can return a misleading `true` from `setAsDefaultProtocolClient` while Launch Services still has no app bound to the scheme.
- Put development builds behind `thinkwork-dev://` and production behind `thinkwork://`; do not share schemes across stages.
- Keep PKCE verifier in memory only. The spike generated 43-character base64url verifier/challenge strings from 32 random bytes and Cognito accepted the S256 authorize request.
- `safeStorage.isEncryptionAvailable()` should run after `app.whenReady()`. On macOS it returned `true`; Linux `basic_text` degraded behavior remains a production unit-test concern, not a macOS spike result.

## Production Pattern Chosen

Use the buffered main-process callback pattern:

1. Register privileged schemes and `open-url` synchronously in `src/main/index.ts`.
2. Push incoming URLs into an in-memory queue and call `event.preventDefault()`.
3. At `whenReady()`, snapshot env, initialize storage, register IPC handlers, then drain the queue through a strict URL/state validator.
4. Exchange the code in main, store tokens in `safeStorage`, resolve `users.id` via the API, then notify the renderer through typed IPC.

This avoids TanStack Router timing races and keeps single-use OAuth codes out of renderer-owned routing state.

## Constraints To Carry Forward

- The spike did not manually lock the user's login keychain because that is disruptive in an unattended autopilot run. U5 should expose injectable `safeStorage` dependencies so degraded mode is covered by deterministic tests.
- `protocol.handle` should be unit-tested with raw path inputs in addition to renderer `fetch()` tests. Chromium normalizes some encoded dot-segment URLs before the handler sees them, so production traversal tests need to exercise the resolver function directly.
- Do not treat dev-mode default protocol registration as a reliable smoke. The release workflow should validate the packaged app metadata instead.

## Commands

- `pnpm view electron version` -> `42.2.0`
- `SPIKE_SCENARIO=protocol-fetch pnpm start`
- `open 'thinkwork-dev://oauth/callback?code=cold-code&state=expected-state'`
- Cognito hosted UI PKCE probe returned `{"status":302,"okPKCERequest":true,"redirected":true}` without printing secrets.
