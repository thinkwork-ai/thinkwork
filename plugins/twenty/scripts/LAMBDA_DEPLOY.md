# TEI LastMile → Twenty sync — Lambda deploy runbook

Deploy the nightly LastMile → Twenty delta sync as an AWS Lambda in **TEI's
account** (the same account as `n8n.lastmile-tei.com` and the LastMile RDS), and
invoke it nightly from n8n. The function reuses the exact code proven against
TEI's live Twenty; a full delta run is ~90s, so it fits Lambda's 15-minute
ceiling with wide headroom.

**Properties:** idempotent (upsert by `sourceId` + deletion mirror), reads
LastMile **read-only**, never provisions members, needs **no AWS credentials**
of its own (the ~4 CRM attachments Twenty can't ingest are reported, not fatal).

---

## 1. Build the deployment zip

From the repo root:

```bash
pnpm install
bash plugins/twenty/scripts/build-lambda.sh
# → plugins/twenty/dist/tei-lastmile-sync-lambda.zip   (handler: index.handler)
```

The zip is self-contained (pg, bcryptjs, aws-sdk all inlined) — no `npm install`
in the account.

## 2. Create the function

- **Runtime:** Node.js 22.x
- **Handler:** `index.handler`
- **Architecture:** arm64 or x86_64 (either)
- **Timeout:** 300s (run is ~90s; leaves headroom for a busier delta)
- **Memory:** 512 MB
- **Code:** upload `tei-lastmile-sync-lambda.zip`

```bash
aws lambda create-function \
  --function-name tei-lastmile-sync \
  --runtime nodejs22.x --handler index.handler \
  --timeout 300 --memory-size 512 \
  --role arn:aws:iam::<ACCOUNT_ID>:role/<lambda-exec-role> \
  --zip-file fileb://plugins/twenty/dist/tei-lastmile-sync-lambda.zip
# later updates: aws lambda update-function-code --function-name tei-lastmile-sync \
#   --zip-file fileb://plugins/twenty/dist/tei-lastmile-sync-lambda.zip
```

## 3. Configuration (the three env vars)

| Variable                | Value                                                |
| ----------------------- | ---------------------------------------------------- |
| `TWENTY_PUBLIC_URL`     | `https://crm.tei.thinkwork.ai`                       |
| `TWENTY_API_KEY`        | Twenty workspace API key (Settings → API & Webhooks) |
| `LASTMILE_DATABASE_URL` | read-only DSN for the `dispatch` database            |

Set them directly as Lambda environment variables, or (preferred) store the two
secrets in Secrets Manager and resolve them at start. If you use Secrets
Manager, add `secretsmanager:GetSecretValue` to the execution role.

```bash
aws lambda update-function-configuration --function-name tei-lastmile-sync \
  --environment "Variables={TWENTY_PUBLIC_URL=https://crm.tei.thinkwork.ai,TWENTY_API_KEY=***,LASTMILE_DATABASE_URL=***}"
```

## 4. Networking — the one thing that must be right

The function must reach **both** the LastMile RDS **and** `crm.tei.thinkwork.ai`.
Mirror wherever n8n already connects to the RDS:

- **In-VPC (cleanest):** attach the Lambda to the RDS's VPC/subnets, give it a
  security group allowed to reach the RDS on 5432, and ensure the subnets have a
  **NAT gateway** so it can still reach `crm.tei.thinkwork.ai` over HTTPS.
- **No-VPC (public):** the RDS is a public endpoint — the function reaches it and
  Twenty over the internet, but the **RDS security group must admit the
  function's egress IP** (the account's NAT/EIP). This is the same allowlisting
  n8n already has.

Execution role needs at least `AWSLambdaBasicExecutionRole` (CloudWatch Logs),
plus `AWSLambdaVPCAccessExecutionRole` if you attach it to a VPC.

## 5. Smoke test before scheduling

Always dry-run first (reads + reports, writes nothing):

```bash
aws lambda invoke --function-name tei-lastmile-sync \
  --payload '{"mode":"dry-run"}' --cli-binary-format raw-in-base64-out out.json
cat out.json   # → {"ok":true,"failed":0,"report":{...parity...}}
```

If `report.mode` is `dry-run` and the entity counts look right, you're wired
correctly. Then run once for real: `--payload '{"mode":"apply"}'` (or `'{}'` —
apply is the default).

## 6. Wire n8n

1. **Schedule Trigger** node — cron `0 3 * * *` (03:00 America/Chicago), or your
   preferred window.
2. **AWS Lambda** node → _Invoke_, region `us-east-1`, function
   `tei-lastmile-sync`, invocation type `RequestResponse`. Leave the payload
   empty (defaults to apply) or send `{"mode":"apply"}`.
3. (Optional) an **IF** node on `{{$json.ok}}` / `{{$json.failed}}` to post a
   Slack/email alert when a run reports soft failures.

n8n's AWS credential needs `lambda:InvokeFunction` on the function ARN.

## 7. Operational invariants (human-owned)

- Keep Twenty's **"Create company when adding a new person"** workflow
  **deactivated** — the API key can't toggle it, and it mislinks new people.
- **Rotate** the shared `TWENTY_REP_PASSWORD` once the validation window closes.
- A **cold re-seed** (empty Twenty) creates thousands of records at Twenty's rate
  limit and can exceed 15 min — run that from the CLI/bundle, not this Lambda.
  Steady-state nightly deltas are the Lambda's job.
