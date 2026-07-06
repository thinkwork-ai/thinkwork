#!/usr/bin/env bash
# Deterministic factory snapshot for the Claude-lane dispatcher.
#
# One call replaces the per-heartbeat reasoning over ps / worktree list / log
# recency in the dispatcher's liveness sweep and duplicate-worker gate
# ("use scripts for deterministic work rather than reasoning steps").
#
# Workers are recorded by a sidecar pid file written at launch:
#   ~/.thinkwork-factory/logs/<ISSUE_ID>-<phase>-<ts>.pid
# next to the matching .log. Output is line-oriented for the dispatcher to
# read verbatim; it makes no Linear calls and mutates nothing.
set -euo pipefail

FACTORY="${THINKWORK_FACTORY_DIR:-$HOME/.thinkwork-factory}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOW=$(date +%s)

shopt -s nullglob

echo "== workers (from ${FACTORY}/logs/*.pid) =="
found=0
for pidfile in "$FACTORY"/logs/*.pid; do
  found=1
  base="${pidfile%.pid}"
  log="$base.log"
  pid="$(tr -cd '0-9' < "$pidfile")"
  if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
    state="ALIVE"
  else
    state="DEAD"
  fi
  if [ -f "$log" ]; then
    size=$(stat -f%z "$log")
    age=$(( NOW - $(stat -f%m "$log") ))
    tail_line=$(tail -c 2000 "$log" | tail -n 1 | cut -c1-160)
  else
    size=0 age=-1 tail_line="(no log file)"
  fi
  echo "$state pid:${pid:-none} log:$log size:$size log_age_s:$age"
  echo "  tail: $tail_line"
done
[ "$found" -eq 0 ] && echo "(no pid files — no recorded local workers)"

echo
echo "== auto worktrees =="
git -C "$REPO_ROOT" worktree list | grep -E '\.claude/worktrees/auto-' || echo "(none)"

echo
echo "== orphan logs (no pid sidecar; pre-sidecar launches or manual runs) =="
orphans=0
for log in "$FACTORY"/logs/*.log; do
  if [ ! -f "${log%.log}.pid" ]; then
    orphans=1
    echo "$log log_age_s:$(( NOW - $(stat -f%m "$log") ))"
  fi
done
[ "$orphans" -eq 0 ] && echo "(none)"
exit 0
