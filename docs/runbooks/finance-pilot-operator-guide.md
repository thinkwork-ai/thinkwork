# Finance pilot — operator runbook

Operator-facing guide for installing the finance-analysis skills into a prospect tenant and demoing the upload-and-analyze flow.

This runbook is intentionally short. The pilot is a focused demo, not a multi-tenant rollout. If you find yourself reaching for a deeper procedure, escalate to engineering rather than improvising.

---

## Prerequisites

1. **The pilot units are deployed to the target stage.** Verify the bundle of PRs landed:
   - `#1234` U9-resolver-patch (security)
   - `#1235` U6 compliance event types
   - `#1236` U5 finance skills (skill catalog)
   - `#1237` U2 attachment upload endpoints
   - `#1238` U3 Strands `/tmp` staging
   - `#1239` U1 Computer composer wiring
   - `#1240` U4 `skill.activated` audit emit (inert; cutover separate)
   - `#1241` U9-remainder admin upload + download endpoint

2. **The Strands AgentCore image is current.** The U3 + U4 changes ship in the Python container; the runtime endpoint flushes via the 15-min reconciler post-merge. Confirm with:
   ```bash
   aws lambda get-function \
     --function-name thinkwork-<stage>-agentcore \
     --query Configuration.ImageUri
   ```
   The SHA suffix should match the latest `main` commit's container image. See `feedback_watch_post_merge_deploy_run` for the gate behavior.

3. **The prospect tenant exists with a Computer template assigned.** Provision via the standard tenant setup; this runbook does not cover tenant provisioning.

4. **You have an authenticated Cognito session for the target stage.** Run `thinkwork login -s <stage>` from a clone of the repo, then `thinkwork me` to verify your tenant/email.

---

## Step 1 — Install the three skills

Get your Cognito ID token (the value used by the admin web app for `Authorization: Bearer ...`). The simplest path: log into the admin SPA at `https://admin-<stage>.thinkwork.ai`, open the browser devtools network tab, find any `/api/...` request, and copy the `Authorization` header value (minus the `Bearer ` prefix).

Then run the installer against the prospect's agent:

```bash
pnpm tsx packages/skill-catalog/scripts/install-finance-pilot.ts \
  --api-url=https://<api-id>.execute-api.us-east-1.amazonaws.com \
  --token=<paste-id-token> \
  --agent-id=<prospect-agent-uuid>
```

(Replace `--agent-id` with `--template-id` if you want every Computer
under a template to inherit the skills.)

Expected output: three `✓` lines per skill (SKILL.md, README.md, and either `LICENSE-NOTES.md` or no extra). The installer is **idempotent** — re-run safely if a network blip drops a file.

---

## Step 2 — Demo flow

1. **Open Computer in the prospect tenant.** Navigate to the Computer app for the agent the skills were installed on.

2. **Drop a sample workbook into the composer.** Drag `~/Desktop/docs/Financial Sample.xlsx` (or any of the prospect's own financial statements) onto the in-thread `FollowUpComposer`. A chip appears with the filename + size.

3. **Type the analysis prompt and submit:**
   > "what stands out in this statement?"

4. **Watch the agent's response.** The reply should cite specific values from the workbook (margins, period comparisons, anomalies). Confirm the model is reading the actual file rather than answering generically.

5. **Open the admin Compliance log filtered to the prospect tenant.** Verify three events landed within the last few minutes:
   - `attachment.received` — payload contains the `attachmentId` (UUID), `mime_type`, `size_bytes`. **No raw `s3_key` or filename** — that's the hardening discipline.
   - `skill.activated` — payload contains `skill_slug` (one of `finance-3-statement-model`, `finance-audit-xls`, `finance-statement-analysis`), `outcome: "allowed"`. (One per distinct skill per turn; the model invoking the same skill twice does NOT produce two events.)
   - `output.artifact_produced` — fires if the agent generated an artifact (table, chart, document) as part of the response. Payload contains `artifact_id`, `artifact_type`, `size_bytes`.

6. **Re-open the thread.** Verify the conversation history persists — the agent's response references the attached file even after the thread is closed and reopened.

7. **Open admin Thread Detail (`/threads/<threadId>`).** The ATTACHMENTS panel lists every uploaded file with filename + MIME + size + timestamp. Click an attachment row to download — the file should be the original bytes (verify with `sha256sum` if you're being thorough).

---

## Pre-pilot gate

Before the prospect-facing demo, run this single sanity check on dev (or whichever stage is hosting the prospect tenant):

```bash
# Confirm the runtime image SHA matches the latest main.
aws lambda get-function \
  --function-name thinkwork-<stage>-agentcore \
  --query Configuration.ImageUri
# vs.
git rev-parse origin/main
```

If they diverge, the Strands container hasn't picked up the U3/U4 changes yet. Wait 15 minutes for the reconciler, or trigger the endpoint update manually (`bash scripts/update-agentcore-runtime-image.sh`).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `installer ✗ skills/.../SKILL.md: 401 Unauthorized` | Token expired (Cognito IDs live ~1 hour) | Re-fetch the bearer token and re-run |
| `installer ✗ skills/.../SKILL.md: 403 Forbidden` | Token belongs to a tenant other than the prospect | Sign in to the prospect tenant first |
| Upload chip stays in "uploading…" state | `WORKSPACE_BUCKET` env not set on the API Lambdas | Check Terraform apply succeeded |
| `415 macro_enabled` on upload | The workbook contains `xl/vbaProject.bin` | Save the workbook as a plain `.xlsx` without macros |
| `415 magic_byte_mismatch` on upload | File extension doesn't match content (e.g., `.xlsx` is actually a renamed `.exe`) | Use the actual file the prospect provided |
| Agent response doesn't cite file values | Strands container hasn't picked up U3 | Confirm runtime image SHA per the pre-pilot gate |
| Compliance log shows `attachment.received` but no `skill.activated` | The Skill meta-tool cutover hasn't landed yet (U4 is inert until the cutover PR) | Expected for now — `skill.activated` will start firing once the cutover ships |
| Drift gate fails post-merge with `MISSING audit_outbox_event_type_prefix_v2` | The `0088_compliance_event_types_finance_pilot.sql` migration wasn't applied to dev | Apply manually: `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0088_compliance_event_types_finance_pilot.sql` |

---

## Cleanup (post-pilot)

If the prospect doesn't move forward and you want to back the skills out:

```bash
# Delete each finance-* skill via the workspace files API (DELETE action).
# A future polish PR will add a `--uninstall` flag to the installer.
```

For now, deletion goes through the admin SPA's workspace files editor.

---

## Related docs

- Plan: `docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md`
- Brainstorm: `docs/brainstorms/2026-05-14-finance-analysis-pilot-requirements.md`
- Audit hardening: see U6 + U2 PRs (`attachmentId` only; never raw `s3_key`).
- Deploy gate: `feedback_watch_post_merge_deploy_run`, `project_agentcore_default_endpoint_no_flush`.
