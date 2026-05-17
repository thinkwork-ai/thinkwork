# Slack Workspace App Handlers

This directory owns the public Slack workspace app ingress Lambdas:

- `POST /slack/events` -> `slack-events`
- `POST /slack/slash-command` -> `slack-slash-command`
- `POST /slack/interactivity` -> `slack-interactivity`
- `GET|POST /slack/oauth/install` -> `slack-oauth-install`

Outbound completion delivery is handled by `packages/lambda/slack-dispatch.ts`.

## Shared ingress contract

All public Slack POST handlers use `_shared.ts`:

1. Read the exact API Gateway raw body bytes.
2. Verify Slack's `v0` HMAC signature and five-minute replay window.
3. Short-circuit Slack retries via `x-slack-retry-num`.
4. Optionally answer URL verification or another pre-dispatch response.
5. Extract the Slack team id.
6. Resolve an active `slack_workspaces` row.
7. Load the workspace bot token from Secrets Manager.
8. Dispatch to the surface-specific handler.
9. Emit `slack.events.ingest_ms` and, when applicable, `slack.events.unknown_team`.

The shared handler must keep the ack path small. Do not wait for Computer runtime work inside a Slack ingress Lambda.

## Secrets and storage

Terraform provisions the shared app credentials secret at `thinkwork/<stage>/slack/app` with JSON fields:

- `signing_secret`
- `client_id`
- `client_secret`

The Lambda environment receives only `SLACK_APP_CREDENTIALS_SECRET_ARN`.

Per-workspace bot tokens are stored by the OAuth install flow under tenant-scoped Secrets Manager paths referenced by `slack_workspaces.bot_token_secret_path`.

## Surface handlers

### `events.ts`

Handles Slack Events API callbacks:

- URL verification before workspace lookup.
- `app_mention` events.
- direct-message `message` events.
- unlinked-user connection prompts.
- source-thread context fetch.
- best-effort placeholder posting.
- `computer_tasks` enqueue with `idempotencyKey=event_id`.

Duplicate Slack event deliveries are accepted and counted via `slack.events.dedupe_hits`; they do not post a second placeholder or enqueue duplicate Computer work.

### `slash-command.ts`

Handles `/thinkwork <prompt>`:

- Parses form-encoded Slack command bodies.
- Returns an immediate empty 200 ack for valid linked users.
- Enqueues a `thread_turn` task with `responseUrl` delivery metadata.
- Returns an ephemeral link prompt for unlinked users.
- Returns a usage hint for empty prompts.

Final answers are delivered by `slack-dispatch` to the `response_url` with a **Post to channel** button.

### `interactivity.ts`

Handles Slack interactivity payloads:

- message shortcuts (`message_action`)
- App Home connect actions
- public promotion of slash-command ephemeral responses

Message shortcuts open a working modal before enqueueing Computer work. The dispatcher later updates the modal and posts the final response in the source thread.

Public promotion posts to the channel first and deletes the original ephemeral response only after the public post succeeds.

### `oauth-install.ts`

Handles workspace-level Slack OAuth installation:

- validates signed install state
- exchanges Slack OAuth codes
- stores bot tokens in Secrets Manager
- upserts `slack_workspaces`

Per-user Slack identity linking is handled by the generic mobile OAuth flow and `slack_user_links`, not by this install handler.

## Envelope and thread mapping

Slack Computer work uses the normal `task_type=thread_turn` with `input.source="slack"`.

The canonical envelope lives in `packages/api/src/lib/slack/envelope.ts`. It includes Slack delivery metadata under both top-level fields and `input.slack` so runtime and dispatcher code can resolve the same payload safely.

Thread/message mapping lives in `packages/api/src/lib/slack/thread-mapping.ts`. It maps Slack workspace/channel/thread coordinates to ThinkWork thread/message ids and keeps Slack-origin work attached to the right Computer thread.

## Metrics

Slack ingress emits CloudWatch EMF metrics through `packages/api/src/lib/slack/metrics.ts`:

- `slack.events.ingest_ms`
- `slack.events.dedupe_hits`
- `slack.events.unknown_team`

The dispatcher emits:

- `slack.dispatch.success`
- `slack.dispatch.failure`
- `slack.attribution.degraded`

Operational guidance lives in `docs/src/content/docs/operations/slack-dispatch-runbook.md`.

## Attribution degradation

The preferred Slack rendering uses `chat:write.customize` so a response appears as `<DisplayName>'s Computer` with the user's avatar. That scope is optional. If Slack returns `missing_scope` or `not_allowed_token_type`, the dispatcher records `slack.attribution_degraded`, retries with the normal bot identity, prefixes the body with the Computer name, and keeps the footer:

`Routed via @ThinkWork · <DisplayName>'s Computer`

Do not remove the footer. It is the durable attribution path for enterprise workspaces that decline identity customization.
