---
title: Enforce Computer Production Sandbox For Generated Apps
date: 2026-05-10
status: active
---

# Enforce Computer Production Sandbox For Generated Apps

## Problem

Production Computer artifacts currently render through the generated-app iframe substrate when sandbox configuration is present, but the deployment still carries a same-origin legacy fallback. That fallback lets generated React artifacts execute inside the `computer.thinkwork.ai` origin if the sandbox URL is absent, which undermines the enterprise isolation boundary.

## Scope

This plan removes the generated-code same-origin fallback and makes the sandbox host mandatory for production generated artifacts.

In scope:

- Provision `sandbox.<apex>` through the greenfield deploy wiring.
- Pass the Mapbox public token into Computer host and iframe-shell builds.
- Make `scripts/build-computer.sh` fail when sandbox outputs are missing.
- Remove `VITE_APPLET_LEGACY_LOADER` and the AppletMount legacy branch.
- Keep generated artifacts on `sandboxedGenerated`; ignore metadata attempts to opt into `nativeTrusted`.

Out of scope:

- Deleting iframe-shell internals, import shims, or host registries still used by the sandbox bundle.
- Reworking app refresh/state proxy semantics beyond preventing same-origin generated-code execution.

## Implementation Units

### U1. Production Sandbox Infra Wiring

Files:

- `.github/workflows/deploy.yml`
- `terraform/examples/greenfield/main.tf`
- `terraform/modules/app/www-dns/main.tf`
- `terraform/modules/app/www-dns/variables.tf`
- `terraform/modules/thinkwork/main.tf`
- `scripts/build-computer.sh`
- `apps/cli/__tests__/terraform-sandbox-host-fixture.test.ts`

Tests:

- `pnpm --filter thinkwork-cli test -- __tests__/terraform-sandbox-host-fixture.test.ts`
- `bash scripts/build-computer.test.sh`
- `terraform -chdir=terraform/examples/greenfield validate`

### U2. Remove Same-Origin Generated-App Fallback

Files:

- `apps/computer/src/applets/mount.tsx`
- `apps/computer/src/applets/_testing/legacy-loader.ts`
- `apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx`
- `apps/computer/src/components/apps/InlineAppletEmbed.tsx`
- Relevant tests under `apps/computer/src/**`

Tests:

- `pnpm --filter @thinkwork/computer test -- src/routes/_authed/_shell/-artifacts.$id.test.tsx`
- `pnpm --filter @thinkwork/computer test -- src/components/apps/InlineAppletEmbed.test.tsx`
- `pnpm --filter @thinkwork/computer typecheck`

## Acceptance

- Production deploy outputs a non-empty `computer_sandbox_url`.
- `apps/computer/.env.production` is built with `VITE_SANDBOX_IFRAME_SRC=https://sandbox.thinkwork.ai/iframe-shell.html`.
- Generated app routes and inline embeds always mount through `IframeAppletController`.
- No `VITE_APPLET_LEGACY_LOADER` or same-origin loader branch remains.
- Mapbox tiles can load from both host CSP and sandbox CSP.
