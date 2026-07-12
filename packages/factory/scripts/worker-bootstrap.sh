#!/usr/bin/env bash
#
# worker-bootstrap.sh — deterministic worktree bootstrap for factory workers.
#
# Dispatcher-owned fixture gate (R6): every step either succeeds or refuses
# with a NAMED non-zero exit code so the daemon can mark the attempt Failed
# with a precise reason and never launch a worker into a broken workspace.
#
# Usage:
#   worker-bootstrap.sh --repo <main-checkout> --worktree <target-path> \
#     --branch <auto/slug-phase-aN> [--base origin/main] [--port <dev-port>]
#
# Steps (cheap preconditions first — refuse before mutating anything):
#   1. target path must not exist (dirty/existing → refuse)
#   2. branch must not already exist
#   3. apps/web/.env must exist in the main checkout (copy source)
#   4. requested Cognito-safe dev port must be free
#   5. git fetch origin
#   6. git worktree add -b <branch> <target> <base>
#   7. purge tsconfig.tsbuildinfo files (stale incremental-build cache
#      cross-contaminates checkouts — see docs/solutions/build-errors/
#      worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md)
#   8. copy apps/web/.env (required) and apps/mobile/.env (if present)
#
# Named exit codes (keep in sync with __tests__/bootstrap.test.ts):
EXIT_USAGE=64
EXIT_REPO_NOT_GIT=65
EXIT_FETCH_FAILED=66
EXIT_TARGET_EXISTS=67
EXIT_BRANCH_EXISTS=68
EXIT_WORKTREE_ADD_FAILED=69
EXIT_TSBUILDINFO_PURGE_FAILED=70
EXIT_ENV_SOURCE_MISSING=71
EXIT_ENV_COPY_FAILED=72
EXIT_PORT_BUSY=73

set -u

die() { # die <exit-code> <name> <message>
  echo "worker-bootstrap: $2: $3" >&2
  exit "$1"
}

REPO=""
WORKTREE=""
BRANCH=""
BASE="origin/main"
PORT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)     REPO="${2:-}"; shift 2 ;;
    --worktree) WORKTREE="${2:-}"; shift 2 ;;
    --branch)   BRANCH="${2:-}"; shift 2 ;;
    --base)     BASE="${2:-}"; shift 2 ;;
    --port)     PORT="${2:-}"; shift 2 ;;
    *) die "$EXIT_USAGE" "usage" "unknown argument: $1" ;;
  esac
done

[ -n "$REPO" ] && [ -n "$WORKTREE" ] && [ -n "$BRANCH" ] ||
  die "$EXIT_USAGE" "usage" "required: --repo <main-checkout> --worktree <target> --branch <name> [--base <ref>] [--port <n>]"

git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 ||
  die "$EXIT_REPO_NOT_GIT" "repo-not-git" "$REPO is not a git checkout"

# 1. Refuse on dirty/existing target path — never reuse another attempt's dir.
[ ! -e "$WORKTREE" ] ||
  die "$EXIT_TARGET_EXISTS" "target-exists" "target path already exists: $WORKTREE"

# 2. Refuse when the attempt branch already exists (each attempt gets a fresh one).
if git -C "$REPO" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  die "$EXIT_BRANCH_EXISTS" "branch-exists" "branch already exists: $BRANCH"
fi

# 3. Env copy source must exist in the main checkout (apps/web/.env is
#    gitignored — a fresh worktree cannot run the web dev server without it).
[ -f "$REPO/apps/web/.env" ] ||
  die "$EXIT_ENV_SOURCE_MISSING" "env-source-missing" "missing $REPO/apps/web/.env"

# 4. Assert the requested Cognito-safe dev port is free (each concurrent
#    worktree needs its own port listed in the Cognito CallbackURLs).
if [ -n "$PORT" ]; then
  port_busy=""
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && port_busy=1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 && port_busy=1
  fi
  [ -z "$port_busy" ] ||
    die "$EXIT_PORT_BUSY" "port-busy" "port $PORT is already in use"
fi

# 5. Fetch so the base ref is current.
git -C "$REPO" fetch origin --quiet ||
  die "$EXIT_FETCH_FAILED" "fetch-failed" "git fetch origin failed in $REPO"

# 6. Create the attempt worktree on its own branch.
git -C "$REPO" worktree add --quiet -b "$BRANCH" "$WORKTREE" "$BASE" ||
  die "$EXIT_WORKTREE_ADD_FAILED" "worktree-add-failed" "git worktree add failed for $WORKTREE ($BRANCH from $BASE)"

# 7. Purge stale TypeScript incremental-build state.
find "$WORKTREE" -name "tsconfig.tsbuildinfo" -not -path "*/node_modules/*" -delete ||
  die "$EXIT_TSBUILDINFO_PURGE_FAILED" "tsbuildinfo-purge-failed" "failed purging tsconfig.tsbuildinfo under $WORKTREE"

# 8. Copy gitignored env files from the main checkout.
mkdir -p "$WORKTREE/apps/web" &&
  cp "$REPO/apps/web/.env" "$WORKTREE/apps/web/.env" ||
  die "$EXIT_ENV_COPY_FAILED" "env-copy-failed" "failed copying apps/web/.env into $WORKTREE"
if [ -f "$REPO/apps/mobile/.env" ]; then
  mkdir -p "$WORKTREE/apps/mobile" &&
    cp "$REPO/apps/mobile/.env" "$WORKTREE/apps/mobile/.env" ||
    die "$EXIT_ENV_COPY_FAILED" "env-copy-failed" "failed copying apps/mobile/.env into $WORKTREE"
fi

echo "worker-bootstrap: ok: $WORKTREE ($BRANCH from $BASE)"
