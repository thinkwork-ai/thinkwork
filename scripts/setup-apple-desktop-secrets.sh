#!/usr/bin/env bash
# Install the GitHub Actions secrets required for signed/notarized macOS
# desktop releases.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  APPLE_API_KEY_ID=<key-id> \
  APPLE_API_KEY_ISSUER=<issuer-id> \
  APPLE_TEAM_ID=<team-id> \
  MAC_CSC_KEY_PASSWORD=<p12-password> \
  bash scripts/setup-apple-desktop-secrets.sh \
    --api-key /path/AuthKey_<key-id>.p8 \
    --cert /path/Developer-ID-Application.p12

Options:
  --api-key PATH   App Store Connect API key .p8 file.
  --cert PATH      Developer ID Application certificate exported as .p12.
  --repo REPO      GitHub repo, default thinkwork-ai/thinkwork.
  --help           Show this help.

Required environment:
  APPLE_API_KEY_ID
  APPLE_API_KEY_ISSUER
  APPLE_TEAM_ID
  MAC_CSC_KEY_PASSWORD
EOF
}

API_KEY_PATH=""
CERT_PATH=""
REPO="thinkwork-ai/thinkwork"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)
      API_KEY_PATH="${2:?--api-key requires a path}"
      shift 2
      ;;
    --api-key=*)
      API_KEY_PATH="${1#--api-key=}"
      shift
      ;;
    --cert)
      CERT_PATH="${2:?--cert requires a path}"
      shift 2
      ;;
    --cert=*)
      CERT_PATH="${1#--cert=}"
      shift
      ;;
    --repo)
      REPO="${2:?--repo requires owner/name}"
      shift 2
      ;;
    --repo=*)
      REPO="${1#--repo=}"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

missing=()
for name in APPLE_API_KEY_ID APPLE_API_KEY_ISSUER APPLE_TEAM_ID MAC_CSC_KEY_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if [[ -z "$API_KEY_PATH" ]]; then
  missing+=("--api-key")
elif [[ ! -f "$API_KEY_PATH" ]]; then
  echo "API key file does not exist: $API_KEY_PATH" >&2
  exit 1
fi
if [[ -z "$CERT_PATH" ]]; then
  missing+=("--cert")
elif [[ ! -f "$CERT_PATH" ]]; then
  echo "Certificate file does not exist: $CERT_PATH" >&2
  exit 1
fi
if [[ "${#missing[@]}" -gt 0 ]]; then
  printf 'Missing required Apple desktop release inputs:\n' >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 2
fi

command -v gh >/dev/null || {
  echo "GitHub CLI is required to set repo secrets." >&2
  exit 1
}

gh auth status >/dev/null

echo "Setting Apple desktop release secrets on $REPO ..."
gh secret set APPLE_API_KEY_ID --repo "$REPO" --body "$APPLE_API_KEY_ID"
gh secret set APPLE_API_KEY_ISSUER --repo "$REPO" --body "$APPLE_API_KEY_ISSUER"
gh secret set APPLE_TEAM_ID --repo "$REPO" --body "$APPLE_TEAM_ID"
base64 -i "$API_KEY_PATH" | tr -d '\n' | gh secret set APPLE_API_KEY_P8_BASE64 --repo "$REPO"
base64 -i "$CERT_PATH" | tr -d '\n' | gh secret set MAC_CSC_LINK --repo "$REPO"
gh secret set MAC_CSC_KEY_PASSWORD --repo "$REPO" --body "$MAC_CSC_KEY_PASSWORD"

echo "Apple desktop release secrets are installed."
