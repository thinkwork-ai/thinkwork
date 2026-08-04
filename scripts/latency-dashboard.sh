#!/usr/bin/env bash
# Thread Agent latency measurement pack (THINK-582 / plan 2026-08-03-001 U1).
#
# Codifies the 2026-08-03 baseline Logs Insights queries so every later unit of
# the AgentCore warm-sessions migration proves its win against the same numbers.
#
# Sections:
#   report          REPORT p50/p90 duration + cold-start ratio for chat-agent-invoke,
#                   workspace-renderer, and the Pi runtime Lambda
#   api-phases      api.* phase durations from chat-agent-invoke (p50/p90 by phase)
#   runtime-phases  runtime.* phase durations from the Pi container (p50/p90 by phase)
#   cohort          per-turn harness overhead (turn wall-clock minus runtime.agent_loop),
#                   split into follow-up (prev turn on thread <= 15 min earlier) vs first/idle
#                   cohorts, plus the inter-message gap distribution
#
# Baselines (dev, 2026-08-03): chat-agent-invoke p50 10.3 s (workspace_render 5.0 s,
# 59% cold), Pi Lambda cold init 3-6 s, tool_assembly ~1.2 s, agent_loop p50 9.6 s.
#
# Usage:
#   scripts/latency-dashboard.sh --stage dev [--hours 168] [--section all|report|api-phases|runtime-phases|cohort|soak]
#
# Requires: aws CLI creds for the stage account, python3, jq.

set -euo pipefail

STAGE="dev"
HOURS=168
SECTION="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift 2 ;;
    --hours) HOURS="$2"; shift 2 ;;
    --section) SECTION="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

END_TS=$(date +%s)
START_TS=$((END_TS - HOURS * 3600))
FOLLOWUP_GAP_SECONDS=900

CAI_LG="/aws/lambda/thinkwork-${STAGE}-api-chat-agent-invoke"
FIN_LG="/aws/lambda/thinkwork-${STAGE}-api-chat-agent-finalize"
WSR_LG="/aws/lambda/thinkwork-${STAGE}-api-workspace-renderer"
PI_LG="/thinkwork/${STAGE}/agentcore-pi"
DSP_LG="/aws/lambda/thinkwork-${STAGE}-api-agentcore-runtime-dispatch"
RUNTIME_LG_PREFIX="/aws/bedrock-agentcore/runtimes"

run_query() {
  # run_query <log-group> <query> -> prints results JSON to stdout
  local lg="$1" query="$2" qid status
  qid=$(aws logs start-query \
    --log-group-name "$lg" \
    --start-time "$START_TS" --end-time "$END_TS" \
    --query-string "$query" \
    --query queryId --output text) || return 1
  [[ -n "$qid" && "$qid" != "None" ]] || { echo "start-query returned no id for $lg" >&2; return 1; }
  while :; do
    status=$(aws logs get-query-results --query-id "$qid" --query status --output text)
    case "$status" in
      Complete) break ;;
      Failed|Cancelled|Timeout) echo "query $status on $lg" >&2; return 1 ;;
      *) sleep 2 ;;
    esac
  done
  aws logs get-query-results --query-id "$qid" --output json
}

print_table() {
  # stdin: get-query-results JSON -> aligned table of field/value rows
  jq -r '.results[] | [.[] | "\(.field)=\(.value)"] | join("  ")'
}

section_report() {
  echo "== REPORT stats (p50/p90 duration ms, cold ratio) — last ${HOURS}h, stage ${STAGE} =="
  local q='filter @type = "REPORT"
    | stats count(*) as invocations,
            pct(@duration, 50) as p50_ms,
            pct(@duration, 90) as p90_ms,
            sum(strcontains(@message, "Init Duration")) as cold_starts,
            pct(@initDuration, 50) as p50_init_ms'
  for lg in "$CAI_LG" "$WSR_LG" "$PI_LG"; do
    echo "-- $lg"
    run_query "$lg" "$q" | print_table || true
  done
}

section_api_phases() {
  echo "== chat-agent-invoke api.* phase durations — last ${HOURS}h =="
  run_query "$CAI_LG" 'filter event = "agentcore_phase" and status = "completed" and ispresent(durationMs)
    | stats count(*) as n, pct(durationMs, 50) as p50_ms, pct(durationMs, 90) as p90_ms by phase
    | sort phase' | print_table
}

section_runtime_phases() {
  echo "== Pi runtime.* phase durations — last ${HOURS}h =="
  run_query "$PI_LG" 'filter event = "agentcore_phase" and status = "completed" and ispresent(durationMs)
    | stats count(*) as n, pct(durationMs, 50) as p50_ms, pct(durationMs, 90) as p90_ms by phase
    | sort phase' | print_table
}

section_cohort() {
  echo "== Per-turn harness overhead + follow-up cohort (gap <= ${FOLLOWUP_GAP_SECONDS}s) — last ${HOURS}h =="
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' RETURN

  # Turn starts: api.invoke.received (started) — ts, threadId, threadTurnId
  run_query "$CAI_LG" 'filter event = "agentcore_phase" and phase = "api.invoke.received" and status = "started"
    | fields ts, threadId, threadTurnId
    | limit 10000' > "$tmpdir/starts.json"

  # Turn ends: api.finalize.response completed — ts, threadTurnId
  run_query "$FIN_LG" 'filter event = "agentcore_phase" and phase = "api.finalize.response" and status = "completed"
    | fields ts, threadId, threadTurnId
    | limit 10000' > "$tmpdir/ends.json"

  # Model-loop time per turn: runtime.agent_loop completed — durationMs, sessionId (= threadTurnId)
  run_query "$PI_LG" 'filter event = "agentcore_phase" and phase = "runtime.agent_loop" and status = "completed"
    | fields ts, durationMs, sessionId, threadTurnId
    | limit 10000' > "$tmpdir/loops.json"

  python3 - "$tmpdir" "$FOLLOWUP_GAP_SECONDS" <<'PYEOF'
import json, sys, statistics
from datetime import datetime, timezone

tmpdir, gap_cut = sys.argv[1], float(sys.argv[2])

def rows(path):
    with open(f"{tmpdir}/{path}") as f:
        data = json.load(f)
    out = []
    for r in data.get("results", []):
        out.append({c["field"]: c["value"] for c in r})
    return out

def parse_ts(v):
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None

# NOTE: api.invoke.received (started) carries NO threadTurnId — the turn row may not
# exist yet at that point. Join finalize->invoke by threadId (nearest preceding start)
# and finalize->agent_loop by threadTurnId (both sides carry it).
starts = [r for r in rows("starts.json") if parse_ts(r.get("ts"))]
ends = [r for r in rows("ends.json") if parse_ts(r.get("ts")) and r.get("threadTurnId")]
loops = {}
for r in rows("loops.json"):
    key = r.get("threadTurnId") or r.get("sessionId")
    if key and r.get("durationMs"):
        loops[key] = float(r["durationMs"])

# Turn starts per thread, sorted; also drives the inter-message gap distribution.
by_thread = {}
for r in starts:
    by_thread.setdefault(r.get("threadId") or "?", []).append(parse_ts(r["ts"]))
for turns in by_thread.values():
    turns.sort()

gaps = []
for turns in by_thread.values():
    for i in range(1, len(turns)):
        gaps.append(turns[i] - turns[i - 1])

# Harness overhead per turn: (finalize.response ts - nearest preceding invoke.received
# on the same thread) - agent_loop duration. Cohort = gap from the previous start on
# that thread at the matched start.
overhead_followup, overhead_other, matched = [], [], 0
for e in ends:
    tid = e["threadTurnId"]
    thread_starts = by_thread.get(e.get("threadId") or "?", [])
    end_ts = parse_ts(e["ts"])
    prior = [t for t in thread_starts if t < end_ts]
    if not prior or tid not in loops:
        continue
    start_ts = prior[-1]
    wall = end_ts - start_ts
    if wall <= 0 or wall > 1800:
        continue
    overhead = wall - loops[tid] / 1000.0
    matched += 1
    idx = thread_starts.index(start_ts)
    is_followup = idx > 0 and (start_ts - thread_starts[idx - 1]) <= gap_cut
    (overhead_followup if is_followup else overhead_other).append(overhead)

def pct(vals, p):
    if not vals:
        return float("nan")
    vals = sorted(vals)
    k = max(0, min(len(vals) - 1, round(p / 100 * (len(vals) - 1))))
    return vals[k]

print(f"turn starts: {len(starts)}  finalized turns: {len(ends)}  agent_loop rows: {len(loops)}  matched full turns (start+finalize+agent_loop): {matched}")
print(f"follow-up cohort (gap <= {int(gap_cut)}s): {len(overhead_followup)} turns  "
      f"overhead p50 {pct(overhead_followup,50):.1f}s  p90 {pct(overhead_followup,90):.1f}s")
print(f"first/idle cohort:                {len(overhead_other)} turns  "
      f"overhead p50 {pct(overhead_other,50):.1f}s  p90 {pct(overhead_other,90):.1f}s")

if gaps:
    buckets = [(60, "<1m"), (300, "1-5m"), (900, "5-15m"), (3600, "15-60m"), (float("inf"), ">60m")]
    counts = {label: 0 for _, label in buckets}
    for g in gaps:
        for cut, label in buckets:
            if g <= cut:
                counts[label] += 1
                break
    total = len(gaps)
    within = sum(1 for g in gaps if g <= gap_cut)
    print(f"\ninter-message gap distribution ({total} gaps; "
          f"{100*within/total:.0f}% within {int(gap_cut/60)} min — warm-session premise):")
    for _, label in buckets:
        n = counts[label]
        print(f"  {label:>7}: {n:4d}  {'#' * int(40 * n / total)}")
else:
    print("no inter-message gaps found in window")
PYEOF
}


section_soak() {
  # THINK-587 U8: runtime-dispatch soak signals against the R18 thresholds.
  echo "== Soak signals (THINK-587 U8) — last ${HOURS}h, stage ${STAGE} =="

  echo "-- dispatcher invoke outcomes (api.runtime_dispatch.invoke)"
  run_query "$DSP_LG" 'filter event = "agentcore_phase" and phase = "api.runtime_dispatch.invoke"
    | stats count(*) as n, pct(durationMs, 50) as p50_ms, pct(durationMs, 90) as p90_ms, max(durationMs) as max_ms by status' | print_table || true

  echo "-- dispatcher near-timeout (>870s) invocations"
  run_query "$DSP_LG" 'filter @type = "REPORT" and @duration > 870000
    | stats count(*) as near_timeout_invocations' | print_table || true

  echo "-- legacy_lambda_dispatch sentinels (must be 0 for flagged agents)"
  run_query "$CAI_LG" 'filter event = "legacy_lambda_dispatch"
    | stats count(*) as sentinel_count' | print_table || true

  echo "-- DLQ redrive activity (must be 0 in steady state)"
  # The log group only exists after the consumer's first invocation — a
  # missing group IS the zero-redrives signal.
  run_query "/aws/lambda/thinkwork-${STAGE}-api-agentcore-dispatch-dlq-redrive" 'filter event = "dispatch_dlq_redrive"
    | stats count(*) as redriven by outcome' 2>/dev/null | print_table || echo "  (no redrive invocations yet)"

  echo "-- session_reuse hit rate (U7 warm fast path; empty until U7 deploys)"
  local runtime_lg
  runtime_lg=$(aws logs describe-log-groups --log-group-name-prefix "$RUNTIME_LG_PREFIX"     --query "logGroups[?contains(logGroupName, 'thinkwork_${STAGE}_pi')].logGroupName | [0]" --output text 2>/dev/null)
  if [[ -n "$runtime_lg" && "$runtime_lg" != "None" ]]; then
    run_query "$runtime_lg" 'filter ispresent(session_reuse)
      | stats count(*) as n by session_reuse' | print_table || true
  else
    echo "  (no AgentCore runtime log group found)"
  fi

  echo "-- current DLQ depth"
  aws sqs get-queue-attributes     --queue-url "https://sqs.us-east-1.amazonaws.com/$(aws sts get-caller-identity --query Account --output text)/thinkwork-${STAGE}-agentcore-dispatch-dlq"     --attribute-names ApproximateNumberOfMessages     --query 'Attributes.ApproximateNumberOfMessages' --output text 2>/dev/null || echo "  (queue not found)"

  echo "-- turn error rate (thread_turns not queryable here; failed dispatcher phases above are the proxy)"
}

case "$SECTION" in
  all) section_report; echo; section_api_phases; echo; section_runtime_phases; echo; section_cohort; echo; section_soak ;;
  report) section_report ;;
  api-phases) section_api_phases ;;
  runtime-phases) section_runtime_phases ;;
  cohort) section_cohort ;;
  soak) section_soak ;;
  *) echo "unknown section: $SECTION" >&2; exit 2 ;;
esac
