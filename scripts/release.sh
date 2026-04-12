#!/usr/bin/env bash
# Release a new version of thinkwork-cli.
#
# Bumps the CLI version, commits, tags, and pushes. The release
# pipeline (.github/workflows/release.yml) handles npm publish,
# Homebrew tap update, and GitHub Release creation.
#
# Usage:
#   bash scripts/release.sh patch    # 0.4.1 → 0.4.2
#   bash scripts/release.sh minor    # 0.4.1 → 0.5.0
#   bash scripts/release.sh major    # 0.4.1 → 1.0.0
#   bash scripts/release.sh 1.0.0    # explicit version

set -euo pipefail

BUMP="${1:?Usage: release.sh <patch|minor|major|x.y.z>}"
CLI_PKG="apps/cli/package.json"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Ensure CLI package is clean
if [ -n "$(git status --porcelain -- apps/cli/)" ]; then
  echo "Error: working tree has uncommitted changes in apps/cli/"
  echo "Commit or stash them first."
  exit 1
fi

# Ensure on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Error: releases must be cut from main (currently on '$BRANCH')"
  exit 1
fi

# Get current version
CURRENT=$(node -p "require('./$CLI_PKG').version")
echo "Current version: $CURRENT"

# Compute new version
if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW_VERSION="$BUMP"
else
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  case "$BUMP" in
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    *) echo "Error: bump must be patch, minor, major, or x.y.z"; exit 1 ;;
  esac
fi

TAG="v${NEW_VERSION}"

# Check tag doesn't exist
if git tag -l "$TAG" | grep -q "$TAG"; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

echo "Releasing: $CURRENT → $NEW_VERSION ($TAG)"
echo ""

# Bump version in package.json
cd "$REPO_ROOT/apps/cli"
npm version "$NEW_VERSION" --no-git-tag-version
cd "$REPO_ROOT"

# Commit + tag + push
git add "$CLI_PKG"
git commit -m "release: thinkwork-cli v${NEW_VERSION}"
git tag -a "$TAG" -m "thinkwork-cli v${NEW_VERSION}"

echo ""
echo "Pushing commit + tag..."
git push origin main
git push origin "$TAG"

echo ""
echo "✓ Tagged $TAG and pushed to origin"
echo "  → Release pipeline will publish to npm + create GitHub Release"
echo "  → Watch: https://github.com/thinkwork-ai/thinkwork/actions/workflows/release.yml"
