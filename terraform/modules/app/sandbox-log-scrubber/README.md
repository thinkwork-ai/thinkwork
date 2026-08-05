# `sandbox-log-scrubber` — R13 CloudWatch backstop

**Secondary** scrubber for the AgentCore Code Interpreter sandbox. Pattern-
redacts known-shape OAuth tokens in AgentCore `APPLICATION_LOGS` before they
land in the long-term CloudWatch tier. See plan Unit 12 +
`docs/brainstorms/2026-04-22-agentcore-code-sandbox-requirements.md` R13.

## The only scrubbing layer (THINK-617)

The plan's primary layer was a base-image `sitecustomize.py` stdio wrapper
redacting by **value** (plan Unit 4). It never ran: AgentCore Code Interpreter
has no custom-image parameter, so the blessed image was unattachable and the
[`agentcore-code-interpreter`](../agentcore-code-interpreter/) image substrate
has been retired. Sandboxes run the AWS-managed image, so this filter is the
only scrubbing in force.

It redacts by **pattern**: it has no access to session values, only to the
bytes that reach CloudWatch. It covers the _stdio-bypass_ classes named in
R13's residual list —

- `subprocess.run(['env'])`, `subprocess.run(['cat', '/proc/self/environ'])`
- `os.write(fd, ...)` at the file-descriptor level
- C-extension writes to fd 1 directly
- `multiprocessing` workers with fresh Python interpreters where the
  session token set hasn't been populated
- Adversarial split-writes that fragment a token across more bytes than the
  rolling-buffer window

When those bytes carry a token whose _shape_ is recognizable, this backstop
catches it. When they don't (bespoke token formats, high-entropy opaque
strings with no prefix), only the v2 in-process credential proxy can help.

## Pattern set

Defined in `packages/lambda/sandbox-log-scrubber.ts`; add to it before
relying on new token shapes in production:

- `Authorization:\s*Bearer\s+<opaque-run>`
- JWT three-dotted base64url (16 chars min per segment)
- `gh[oprsu]_<A-Za-z0-9>{20,}` — GitHub PATs, OAuth, server-to-server
- `xox[abep]-<A-Za-z0-9-]{10,}` — Slack bot / app / user / export
- `ya29.<A-Za-z0-9_->{20,}` — Google short-lived OAuth

## What it creates

- `/thinkwork/{stage}/sandbox/scrubbed` CloudWatch log group (90-day retention)
- IAM execution role `thinkwork-{stage}-sandbox-log-scrubber`
- Lambda function `thinkwork-{stage}-sandbox-log-scrubber` (node20, 256MB, 30s)
- Subscription filter on the source log group — delivers every event (no filter pattern)
- Invoke permission from CloudWatch Logs to the Lambda

## Failure tolerance

If the scrubber Lambda fails — OOM, bug, cold-start timeout — source events
remain in the original CloudWatch log group. S3 export of the scrubbed group
is delayed, but no data is lost. The source group retains for whatever its
own retention policy specifies (typically 90 days).

## Build + wire

1. `bash scripts/build-lambdas.sh sandbox-log-scrubber` — produces
   `dist/lambdas/sandbox-log-scrubber.zip`.
2. In the caller module (e.g., `terraform/examples/greenfield`), pass
   `lambda_zip_path` and `lambda_zip_hash` (typically `filebase64sha256()`
   of the zip).
3. Pass `source_log_group_name` pointing at the AgentCore runtime group
   emitting APPLICATION_LOGS for the stage.
