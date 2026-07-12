# Slack Workspace App Handlers

This directory owns the public Slack workspace app ingress Lambdas:

- `POST /slack/events` -> `slack-events`
- `GET|POST /slack/oauth/install` -> `slack-oauth-install`

These are the only Slack ingress surfaces. Slash commands, message
shortcuts, modals, and interactivity callbacks are intentionally not
exposed; their handlers and routes were removed rather than left as
accepted-and-dropped endpoints (THINK-84 U3).

Outbound completion delivery is handled by the turn finalizer through
`packages/api/src/lib/slack/thread-reply.ts` — there is no separate
dispatch Lambda.

## Transport boundary

`packages/api/src/lib/slack/provider.ts` is the only module allowed to
import `@chat-adapter/slack` subpaths (exact-pinned). It wraps signature
verification, webhook payload classification, continuation extraction, and
Slack Web API calls, translating every result into ThinkWork-owned plain
values. Chat SDK types must not enter envelope, thread, identity, dispatch,
or finalization modules, and no Chat SDK object is persisted.

## Shared ingress contract

All public Slack POST handlers use `_shared.ts`:

1. Read the exact API Gateway raw body bytes.
2. Verify Slack's `v0` HMAC signature and five-minute replay window
   (U1's exact 401 contract, enforced at the provider boundary).
3. Short-circuit Slack retries via `x-slack-retry-num` unless the handler
   opts into retry dispatch (`slack-events` does; message-level source-event
   idempotency makes redelivery safe).
4. Optionally answer URL verification or another pre-dispatch response.
5. Extract the Slack team id.
6. Resolve an active `slack_workspaces` row.
7. Load the workspace bot token from Secrets Manager.
8. Dispatch to the surface-specific handler.
9. Emit `slack.events.ingest_ms` and, when applicable, `slack.events.unknown_team`.

The shared handler must keep the ack path small: durable persistence and
wakeup creation only, never agent execution.

## Secrets and storage

Terraform provisions the shared app credentials secret at
`thinkwork/<stage>/slack/app` with JSON fields:

- `signing_secret`
- `client_id`
- `client_secret`

The Lambda environment receives only `SLACK_APP_CREDENTIALS_SECRET_ARN`.

Per-workspace bot tokens are stored by the OAuth install flow under
tenant-scoped Secrets Manager paths referenced by
`slack_workspaces.bot_token_secret_path`. Bot tokens are transport-only:
they never become a requester identity.

## Surface handlers

### `events.ts`

Handles Slack Events API callbacks:

- URL verification before workspace lookup.
- `app_mention` events (including channel-message `file_share` mention
  promotion).
- direct-message `message` events.
- unlinked-user account-link prompts (explicit linking only — no email
  auto-linking, and no thread/message/dispatch for unlinked users).
- bounded source-thread context fetch (`conversations.replies`, best effort).
- attachment materialization (best effort; failure never blocks the text turn).
- thread/message persistence via `lib/slack/thread-mapping.ts` — one Slack
  thread maps to one ThinkWork thread in the general Space, and the message
  row carries a provider-prefixed `source_event_id` behind a tenant-scoped
  unique index.
- durable default-agent dispatch through `dispatchDefaultAgentTurn` with the
  linked ThinkWork user as requester.
- a best-effort in-thread acknowledgement post.

Duplicate Slack event deliveries (with or without retry headers) hit the
source-event unique constraint, reuse the existing message, and are counted
via `slack.events.dedupe_hits`; they never create a second message or turn.

Bot-authored, unsupported-subtype, and malformed events are acknowledged
no-ops.

### `oauth-install.ts`

Handles workspace-level Slack OAuth installation:

- validates signed install state
- exchanges Slack OAuth codes
- stores bot tokens in Secrets Manager
- upserts `slack_workspaces`

Per-user Slack identity linking is handled by the generic mobile OAuth flow
and `slack_user_links`, not by this install handler.

## Final response delivery

The turn finalizer (`lib/chat-finalize/process-finalize.ts`) delivers the
persisted assistant message to the originating Slack thread through
`lib/slack/thread-reply.ts`:

- Delivery is origin-gated: it posts only when the turn's triggering user
  message originated from Slack, so web/mobile follow-ups on a Slack-created
  thread never leak externally.
- Delivery is exactly-once per assistant message via a persisted
  `metadata.slackDelivery` claim/success/failure ledger with stale-claim
  recovery; retries redrive failed deliveries without reposting.
- Slack delivery failure is persisted and retryable; it never rolls back the
  assistant message or fails finalization.

## Envelope and thread mapping

The canonical envelope lives in `packages/api/src/lib/slack/envelope.ts`.
Thread/message mapping lives in `packages/api/src/lib/slack/thread-mapping.ts`.
Both are ThinkWork-owned plain data; provider continuation coordinates are
copied into them at the boundary.

## Metrics

Slack ingress emits CloudWatch EMF metrics through
`packages/api/src/lib/slack/metrics.ts` (`ThinkWork/Slack` namespace):
`slack.events.ingest_ms`, `slack.events.dedupe_hits`,
`slack.events.unknown_team`, `slack.dispatch.success`,
`slack.dispatch.failure`.

Metric semantics and operational procedures live in
`docs/src/content/docs/operations/slack-dispatch-runbook.md`.
