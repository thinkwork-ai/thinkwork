---
title: Fix Desktop Downloadable Release Artifact
status: active
created: 2026-05-22
origin: user request for an end-to-end downloadable ThinkWork Spaces installer
---

# Fix Desktop Downloadable Release Artifact

## Problem Frame

The desktop signing/notarization credentials are configured, but pushing
`desktop-v0.1.0-canary.1` did not produce an installable artifact. The release
workflow failed before packaging because it read Terraform outputs without
initializing the Terraform backend. The user needs the end-to-end path to
produce a macOS DMG/zip artifact that can be downloaded from the website/release
surface and installed.

## Scope

- Fix the GitHub Actions release workflow so the tag-triggered desktop build can
  read deployed stage outputs.
- Make the user-facing desktop documentation clearly expose the download path.
- Re-run the release flow with a fresh canary tag and verify a downloadable
  artifact exists.

Out of scope:

- Windows packaging/signing.
- Mac App Store distribution.
- Changing the desktop app runtime behavior.

## Relevant Patterns

- `.github/workflows/deploy.yml` initializes Terraform in
  `terraform/examples/greenfield` before reading outputs or applying changes.
- `scripts/build-desktop.sh` already owns Spaces env generation and
  electron-builder packaging once Terraform outputs are readable.
- `docs/src/content/docs/applications/desktop/index.mdx` is the existing
  end-user desktop documentation page.

## Implementation Units

### U1. Initialize Terraform for Desktop Release

Files:

- `.github/workflows/release-desktop.yml`

Change:

- Add a Terraform init step in `terraform/examples/greenfield` before
  `scripts/build-desktop.sh` runs, then select the release `STAGE` workspace so
  outputs are read from the deployed stage rather than Terraform's default
  workspace.
- Keep this read-only: no plan/apply/deploy mutation.

Tests:

- YAML parse for `.github/workflows/release-desktop.yml`.
- Trigger a fresh `desktop-v*` canary tag and verify the release workflow reaches
  package/sign/notarize/publish instead of failing at Terraform output lookup.
- Use the deployed `dev` Terraform workspace for the first canary release. The
  backend does not currently have a `prod` workspace, so `prod` is not a valid
  target until production Terraform state exists.

### U2. Expose the Download Path on the Website Docs

Files:

- `docs/src/content/docs/applications/desktop/index.mdx`

Change:

- Add an Install section near the top with the GitHub Releases download path and
  guidance for Apple Silicon versus Intel artifacts.
- Keep canary/stable wording honest: canary is the first validation channel;
  stable follows once the canary package is verified.

Tests:

- Prettier check on touched docs.
- `pnpm --filter @thinkwork/docs build`.

## Release Verification

After merging U1/U2:

1. Push a fresh canary tag such as `desktop-v0.1.0-canary.2`.
2. Watch `.github/workflows/release-desktop.yml`.
3. Confirm the GitHub Release contains macOS DMG/zip assets.
4. Download the Apple Silicon DMG on this Mac.
5. Verify the DMG is signed/notarized enough for macOS to open.

## Risks

- Terraform init may require backend access from the GitHub Actions AWS
  credentials. If that fails, the blocker is AWS/backend permission, not Apple
  signing.
- Signing/notarization may reveal a second issue after Terraform output lookup
  succeeds. Fix any such issue in a follow-up PR and cut a new canary tag.
