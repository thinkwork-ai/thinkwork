# ThinkWork Desktop

Electron shell for the `@thinkwork/web` renderer.

There is no local-only backend for this app. Development and packaged smoke
tests use a deployed ThinkWork stage for Cognito, GraphQL, AppSync, and the
sandbox iframe outputs.

## Local Development

From a fresh checkout or worktree:

```bash
pnpm install
find . -name "tsconfig.tsbuildinfo" -not -path "*/node_modules/*" -delete
pnpm --filter @thinkwork/database-pg build
pnpm --filter @thinkwork/desktop dev
```

`electron-vite` starts the Spaces Vite renderer and injects
`__DESKTOP_BUILD__` for desktop-only branches. The web Spaces build does not
define that symbol, so desktop code should guard runtime references with
`typeof __DESKTOP_BUILD__ !== "undefined"` when needed.

If a worktree is missing local app env, copy it from the primary checkout
before launching:

```bash
cp /Users/ericodom/Projects/thinkwork/apps/web/.env apps/web/.env
```

Dev mode launches Electron directly. Packaged-app behavior such as default
protocol ownership, app identity, signing, notarization, and update metadata is
validated through packaged builds.

## Agent Execution

The desktop app is a client for deployed ThinkWork services. Pi agent execution
runs through AWS-managed AgentCore isolation; the Electron shell does not start
or expose a local Pi sidecar, local `just-bash` sandbox, or desktop-local agent
IPC bridge.

## Stage And Channel Identity

The build script writes channel-specific Electron Builder config before
packaging:

| Channel  | Product name                | App ID                               | OAuth scheme                        |
| -------- | --------------------------- | ------------------------------------ | ----------------------------------- |
| `stable` | `ThinkWork Spaces`          | `ai.thinkwork.spaces.desktop`        | `thinkwork://oauth/callback`        |
| `canary` | `ThinkWork Spaces (Canary)` | `ai.thinkwork.spaces.desktop.canary` | `thinkwork-canary://oauth/callback` |
| `dev`    | `ThinkWork Spaces (Dev)`    | `ai.thinkwork.spaces.desktop.dev`    | `thinkwork-dev://oauth/callback`    |

Separate product names and bundle IDs give each variant its own macOS app
container and user data directory, so stable, canary, and dev tokens do not
bleed across installs.

Channel selection is derived in `scripts/build-desktop.sh`:

- `BUILD_CHANNEL` wins when set to `stable`, `canary`, or `dev`.
- A `desktop-v*-canary*` tag selects `canary`.
- The `dev` stage selects `dev`.
- Every other stage defaults to `stable`.

## Building Locally

The normal package command reads Terraform outputs for the selected stage and
then builds Spaces and the Electron shell:

```bash
pnpm --filter @thinkwork/desktop run package
```

For a dry package using already-exported `VITE_*` values instead of Terraform:

```bash
DESKTOP_SKIP_TERRAFORM=1 \
BUILD_CHANNEL=dev \
bash scripts/build-desktop.sh dev --dir --publish never
```

The dry `--dir` package verifies generated bundle metadata with local ad-hoc
signing, without notarizing, publishing, or creating a DMG.

## OAuth Testing

Desktop OAuth uses the system browser, PKCE, and a custom callback scheme. The
target stage must already include the desktop callback URLs on the
`ThinkworkAdmin` Cognito client:

- `thinkwork://oauth/callback`
- `thinkwork-dev://oauth/callback`
- `thinkwork-canary://oauth/callback`

To test dev OAuth:

1. Deploy the Cognito callback URL Terraform change through the normal pipeline.
2. Build or run the dev channel so it owns `thinkwork-dev://`.
3. Click sign in inside the desktop shell.
4. Complete hosted UI sign-in in the system browser.
5. Confirm the app receives the deep link, stores tokens through the desktop
   bridge, and reloads into the authenticated Spaces surface.

macOS keeps one default handler per URL scheme. Stable, canary, and dev use
different schemes, but repeated local installs of the same channel can leave the
newest app as the handler. If callbacks appear to vanish during development,
remove stale local builds of the same channel and reinstall the current one.

## Release Workflow

Desktop releases are created by pushing a tag that matches `desktop-v*`:

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

`.github/workflows/release-desktop.yml` builds on `macos-14`, signs and
notarizes the app, publishes DMG and zip artifacts to GitHub Releases, and
uploads a SHA-256 mirror to the configured docs release endpoint.

> **Note:** the trigger tag is `desktop-v<version>`, but electron-builder
> publishes the GitHub Release and assets under the **`v`-prefixed** name
> (`vPrefixedTagName: true` in `scripts/build-desktop.sh`). So pushing
> `desktop-v0.1.0-canary.73` produces the release `v0.1.0-canary.73` —
> `gh release view desktop-v...` returns "release not found"; look up `v...`.
> A `-canary*`/`-beta*`/`-alpha*` suffix selects the matching auto-update
> channel (`canary-mac.yml`, etc.); a bare `desktop-v<version>` ships stable.

Required GitHub secrets:

- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_ISSUER`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_TEAM_ID`
- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Optional GitHub secrets:

- `DESKTOP_SHA256_MIRROR_URL`
- `DESKTOP_SHA256_MIRROR_TOKEN`

When the SHA-256 mirror secrets are absent, the workflow still uploads the
checksum manifest as a GitHub Actions artifact and skips the mirror upload.

Before launch, run one release build against the dev stage and install it on:

- Apple Silicon native
- Intel Mac
- Apple Silicon running the x64 build under Rosetta

Validate first-launch OAuth, returning-user launch, and update check/download
behavior before cutting a stable public tag.

## Production Install

Download the DMG from the GitHub Release for the desired `desktop-v*` tag, open
it, and drag `ThinkWork Spaces` into Applications. For canary, install
`ThinkWork Spaces (Canary)` side by side with stable.

To verify a downloaded DMG against the mirror:

```bash
VERSION=0.1.0
DMG="ThinkWork Spaces-${VERSION}-arm64.dmg"
shasum -a 256 "$DMG" | grep -f <(curl -fsS "https://docs.thinkwork.ai/releases/${VERSION}.sha256")
```

## Linux SafeStorage Caveat

The launch target is macOS. The safeStorage implementation is platform-aware:
when Electron reports that encrypted storage is unavailable or uses an unsafe
Linux backend such as `basic_text`, the desktop shell refuses to persist refresh
tokens and falls back to an in-memory session. The user can continue for the
current process lifetime but must sign in again after quitting.

## Related Runbooks

- `docs/solutions/runbooks/update-cognito-callback-urls-2026-05-22.md`
- `docs/solutions/runbooks/rotate-apple-developer-credentials-2026-05-22.md`
