# Memory-quality eval harness (THINK-198)

Measures Hindsight retain/extraction quality per candidate retain model, on
real dev threads, with a pinned LLM judge — **before** swapping
`HINDSIGHT_API_RETAIN_LLM_MODEL` on the deployed dev service
(`terraform/modules/app/hindsight-memory/main.tf:289`, current value
`openai.gpt-oss-20b-1:0`).

Design doc: see the brainstorm/plan trail for THINK-198 (P2 of the Brain
quality workstream) for the full feasibility writeup this harness implements.

## Why local Docker, not a second dev service

The Hindsight retain model is a **service-level env var only**
(`HINDSIGHT_API_RETAIN_LLM_MODEL`) — there is no per-bank config knob for it.
Standing up a second Fargate/ALB service on dev to test a model swap is high
blast-radius for zero benefit over a local container. Instead: one local
Hindsight container (image pinned to match dev, `ghcr.io/vectorize-io/
hindsight:0.5.6`) per candidate model, backed by a throwaway local pgvector
Postgres — zero AWS infra changes, only Bedrock inference cost.

## Workflow

### 0. Prerequisites

- Docker running locally (ARM64 native on Apple Silicon — dev's ECS task
  also runs `cpu_architecture = "ARM64"`).
- AWS credentials in the environment with `bedrock:InvokeModel` (the local
  Hindsight container calls Bedrock directly; Eric's own credentials work).
- `DATABASE_URL` for the dev Aurora database (read-only use only) to export
  the fixture.

### 1. Export the fixture (run ONCE)

```bash
DATABASE_URL=<dev-db-url> npx tsx packages/api/scripts/memory-eval/export-threads.ts \
  --count 18 --out /tmp/memory-eval/threads-fixture.json
```

Selects ~18 real dev threads, stratified into 3 size buckets by transcript
character count, excluding `evalTraffic`-flagged messages and titles matching
`(smoke|e2e|eval|test fixture|probe)`. Transcript extraction mirrors the
production retain path exactly (`fetchThreadTranscript`,
`packages/api/src/handlers/memory-retain.ts:813-862`). Applies a best-effort
credential scrub (AWS keys, bearer tokens, JWT-shaped strings) — still do a
manual `grep` pass over the fixture before treating it as safe, and **freeze
this fixture for the whole experiment**: every candidate replays the
identical file.

### 2. Per candidate: boot Hindsight, replay retain, read back units

```bash
# Once, before the first candidate:
docker compose -f packages/api/scripts/memory-eval/docker-compose.yml up -d pg

# Per candidate — pick a model id + a schema name:
CANDIDATE="openai.gpt-oss-20b-1:0" CANDIDATE_SCHEMA=eval_baseline \
  docker compose -f packages/api/scripts/memory-eval/docker-compose.yml up -d --force-recreate hindsight

# Wait for health (first boot downloads embedding weights, ~5 min):
curl http://localhost:8888/health

npx tsx packages/api/scripts/memory-eval/run-retain.ts \
  --candidate gpt-oss-20b-baseline \
  --hindsight-url http://localhost:8888 \
  --bank evalrun \
  --schema eval_baseline \
  --fixture /tmp/memory-eval/threads-fixture.json \
  --out /tmp/memory-eval/runs/gpt-oss-20b-baseline.units.json
```

`run-retain.ts` POSTs each fixture thread to Hindsight with the same wire
shape as `HindsightAdapter.retainConversation`
(`packages/api/src/lib/memory/adapters/hindsight-adapter.ts:412-441`): the
whole transcript flattened into one `content` string (lines `"{role} ({ISO
timestamp}): {content}"`), `document_id = threadId`, `update_mode: "replace"`,
`context: "thinkwork_thread"`. Retain is synchronous with a 300s client
timeout. It then reads the extracted units back from
`<schema>.memory_units` by `bank_id` + `document_id` (confirmed against
`hindsight-adapter.ts` recall mapping — `raw.document_id` is a live column on
`memory_units`) and writes one `<candidate>.units.json` file.

**Candidate #1 must be the baseline**: `openai.gpt-oss-20b-1:0` (current dev
retain model). Every subsequent candidate is compared against it.

Repeat for each candidate: change `CANDIDATE` / `CANDIDATE_SCHEMA`, recreate
the `hindsight` service (the `pg` service and its volume stay up — all
candidates' schemas coexist in the same local Postgres for the report step).

### 3. Judge

```bash
npx tsx packages/api/scripts/memory-eval/judge.ts \
  --candidate gpt-oss-20b-baseline \
  --units /tmp/memory-eval/runs/gpt-oss-20b-baseline.units.json \
  --fixture /tmp/memory-eval/threads-fixture.json \
  --out /tmp/memory-eval/runs/gpt-oss-20b-baseline.scores.json
```

Scores every unit with a pinned judge model
(`us.anthropic.claude-sonnet-4-5-20250929-v1:0`, override via
`--judge-model` / `MEMORY_JUDGE_MODEL_ID`) and prompt version
`memory-judge-v1`, using the `invokeClaudeJson` pattern from
`packages/api/src/lib/wiki/bedrock.ts` (same pattern as
`observation-promotion-gate.ts`). **Never judge with a candidate model under
test.** Rubric: `referentComplete` (0/1 + dangling referents),
`faithful` (0-2), `useful` (0-2), `duplicateOf` (unit id within the same
document, or null). Malformed/missing judge entries default to the
worst-case score rather than being silently dropped.

### 4. Report

```bash
npx tsx packages/api/scripts/memory-eval/report.ts \
  --runs /tmp/memory-eval/runs \
  --out /tmp/memory-eval/report.md
```

Aggregates every `*.scores.json` in `--runs` (or pass explicit `--file`s) into
a markdown comparison table (units/doc, avg unit length, dangling-referent
%, dup %, faithfulness, usefulness) plus a worst-10-units appendix per
candidate. Refuses to compare runs tagged with different judge prompt
versions.

### Decision gate for the P2 swap

A candidate wins if: dangling-referent rate AND dup rate **strictly
improve** vs baseline, faithfulness/usefulness stay `>=` baseline, and retain
latency stays well under the 300s ALB/Lambda budget
(`main.tf:197-205`). Exit criteria per THINK-198: dangling-referent rate
≈ 0. The actual swap is then a one-line terraform change to
`HINDSIGHT_API_RETAIN_LLM_MODEL` (`main.tf:289`).

## Scope / safety notes

- `export-threads.ts` is **read-only** against the dev database.
- Nothing under `src/` imports from this directory — these are operator
  tools, not production code paths.
- The local Hindsight container talks to Bedrock directly over the network
  (not through the Pi Lambda callback-fetch wrapper used in-app) — that's
  fine for a local one-off harness but is NOT the pattern for anything that
  ships to a Lambda.

## Remaining live-smoke steps (not run in this PR — Docker daemon was down)

1. `docker compose -f packages/api/scripts/memory-eval/docker-compose.yml up -d pg` and confirm `pg_isready`.
2. Boot the baseline candidate (`CANDIDATE=openai.gpt-oss-20b-1:0
CANDIDATE_SCHEMA=eval_baseline`), wait for `/health`, and confirm
   `\d eval_baseline.memory_units` has a `document_id` column (the one
   empirically-unverified assumption this harness makes — code references in
   `hindsight-adapter.ts` strongly imply it, but it has not been checked
   against a live migrated schema).
3. Export the real fixture from dev (`export-threads.ts`) and manually
   `grep` it for anything the credential scrub missed before reusing it.
4. Run `run-retain.ts` against the baseline candidate, confirm units land in
   `memory_units`, then repeat for each additional candidate.
5. Run `judge.ts` per candidate (needs Bedrock access for the judge model)
   and `report.ts` to produce the comparison table.
