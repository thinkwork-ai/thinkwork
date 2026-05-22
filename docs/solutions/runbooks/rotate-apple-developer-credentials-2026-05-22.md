---
problem_type: runbook
severity: high
module: .github/workflows/release-desktop.yml
tags:
  - rotation
  - apple
  - desktop
  - code-signing
date: 2026-05-22
---

# Rotate Apple Developer Credentials

The desktop release workflow signs and notarizes macOS artifacts with Apple
Developer credentials stored as GitHub Actions secrets. Rotate these secrets
quarterly, when an operator with access leaves, or immediately after any
suspected exposure.

Secrets used by `.github/workflows/release-desktop.yml`:

- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_ISSUER`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_TEAM_ID`
- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`

The workflow also needs `DESKTOP_SHA256_MIRROR_URL` and
`DESKTOP_SHA256_MIRROR_TOKEN` for the release checksum mirror. Rotate that token
on the same cadence if it is managed by the same operator group.

## Prerequisites

- Apple Developer account access for the ThinkWork team.
- Permission to create or revoke App Store Connect API keys.
- Access to the Developer ID Application certificate private key or the ability
  to create a replacement certificate.
- GitHub CLI authenticated with permission to set repository secrets.

## Steps

### 1. Create a new App Store Connect API key

In App Store Connect, create a new API key with the least role that can
notarize Developer ID software. Download the `.p8` file once and record:

- Key ID
- Issuer ID
- Team ID

Base64-encode the private key without line wrapping:

```bash
base64 -i AuthKey_<KEY_ID>.p8 | tr -d '\n' > /tmp/apple-api-key.p8.base64
chmod 600 /tmp/apple-api-key.p8.base64
```

### 2. Rotate GitHub secrets

```bash
gh secret set APPLE_API_KEY_ID --body "<KEY_ID>"
gh secret set APPLE_API_KEY_ISSUER --body "<ISSUER_ID>"
gh secret set APPLE_TEAM_ID --body "<TEAM_ID>"
gh secret set APPLE_API_KEY_P8_BASE64 --body "$(cat /tmp/apple-api-key.p8.base64)"
```

### 3. Rotate the signing certificate if needed

If the Developer ID Application certificate is also rotating, export the new
certificate and private key as a password-protected `.p12`, then base64-encode
it:

```bash
base64 -i ThinkWork-Developer-ID-Application.p12 | tr -d '\n' > /tmp/mac-csc-link.base64
chmod 600 /tmp/mac-csc-link.base64

gh secret set MAC_CSC_LINK --body "$(cat /tmp/mac-csc-link.base64)"
gh secret set MAC_CSC_KEY_PASSWORD --body "<p12-password>"
```

Keep the old certificate active until the first release signed with the new
certificate is notarized and installed successfully. The app launch guard checks
the Apple Team ID, so certificate replacement is acceptable as long as the Team
ID stays the same.

### 4. Rotate the SHA mirror token if applicable

If the docs release mirror token is in scope for this rotation:

```bash
gh secret set DESKTOP_SHA256_MIRROR_URL --body "https://docs.thinkwork.ai/releases"
gh secret set DESKTOP_SHA256_MIRROR_TOKEN --body "<new-token>"
```

### 5. Verify on the next desktop release

Trigger the tag-based workflow only when you intend to publish a desktop
release:

```bash
git tag desktop-v0.1.1-canary.1
git push origin desktop-v0.1.1-canary.1
```

Watch the run:

```bash
gh run list --workflow release-desktop.yml --limit 5
gh run watch <run-id> --exit-status
```

The workflow must pass these release-specific gates:

- secret preflight
- code signing
- notarization
- GitHub Release upload
- SHA-256 mirror upload

Install the produced DMG and confirm the app launches. A Team ID mismatch fails
at app startup, before the renderer bootstraps.

## Rollback

If signing or notarization fails, restore the previous GitHub secret values and
rerun the failed release job only if the tag has not already published a broken
release. If artifacts were published, prefer a forward patch release with a new
`desktop-v*` tag.

If a new certificate uses a different Apple Team ID, do not ship it as an
in-place update. Existing apps compile the expected Team ID into the main
bundle and will refuse to launch after update. Plan a forced reinstall path
instead.

## Related

- `apps/desktop/README.md`
- `.github/workflows/release-desktop.yml`
- `scripts/build-desktop.sh`
- `docs/solutions/security/rotate-api-auth-secret-2026-04-24.md`
