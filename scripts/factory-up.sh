#!/usr/bin/env bash
# Start the ThinkWork Linear factory — Claude-lane dispatcher.
#
# Usage: run in a terminal you keep open (the dispatcher lives in it):
#   scripts/factory-up.sh
#
# What it does:
#   1. Preflight: claude CLI, gh auth, agent-browser, ~/.thinkwork-factory dirs.
#   2. Keeps the Mac awake (caffeinate tied to this process).
#   3. Starts a Sonnet Claude Code session running `/loop linear-dispatch`
#      (self-paced: the dispatcher picks the next heartbeat delay from factory
#      state — ~4 min while workers/CI/deploys are in flight, 20-30 min when
#      idle) with permissions bypassed so unattended launches never stall.
#
# The /loop recurring task expires after ~7 days — rerun this script weekly,
# after a reboot, or whenever the terminal closes. The Codex lane is separate:
# the "Linear Agent Dispatcher" scheduled task in the Codex app must be
# Active (resume it there if paused).
#
# Contract docs: docs/runbooks/linear-autonomous-development-loop.md
# Dispatcher skill: .claude/skills/linear-dispatch/SKILL.md
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "== ThinkWork factory preflight =="

command -v claude >/dev/null 2>&1 || {
  echo "ERROR: claude CLI not found on PATH." >&2
  exit 1
}

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh CLI missing or not authenticated (run: gh auth login)." >&2
  exit 1
fi

if command -v agent-browser >/dev/null 2>&1; then
  echo "OK: agent-browser $(agent-browser --version 2>/dev/null | head -1)"
else
  echo "WARN: agent-browser not found — dogfood verification workers will" \
    "block with Blocked: Auth. Install it before the next Verification phase."
fi

mkdir -p "$HOME/.thinkwork-factory/prompts" "$HOME/.thinkwork-factory/logs"
echo "OK: worker prompts/logs at ~/.thinkwork-factory/"

stale=$(git worktree list | grep -c '\.claude/worktrees/auto-' || true)
if [ "$stale" -gt 0 ]; then
  echo "NOTE: $stale auto-* worktree(s) present — the dispatcher's janitor" \
    "pass will reconcile them against Linear before launching anything."
fi

echo "NOTE: Codex lane runs separately — confirm the 'Linear Agent Dispatcher'" \
  "scheduled task is Active in the Codex app."

# Keep the Mac awake for exactly as long as this dispatcher process lives.
caffeinate -dimsu -w $$ &

echo
echo "== Starting Claude-lane dispatcher (Sonnet) =="
echo "   /loop linear-dispatch (self-paced) — leave this terminal open."
echo

exec claude --model sonnet --dangerously-skip-permissions "/loop linear-dispatch"
