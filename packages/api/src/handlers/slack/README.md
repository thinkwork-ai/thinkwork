# Slack Workspace App Handlers

This directory owns the public Slack workspace app ingress Lambdas:

- `POST /slack/events` -> `slack-events`
- `POST /slack/slash-command` -> `slack-slash-command`
- `POST /slack/interactivity` -> `slack-interactivity`
- `GET|POST /slack/oauth/install` -> `slack-oauth-install`

Terraform provisions the shared app credentials secret at
`thinkwork/<stage>/slack/app` with JSON fields `signing_secret`, `client_id`,
and `client_secret`. Operators populate the real value in Secrets Manager; the
Lambda environment only receives `SLACK_APP_CREDENTIALS_SECRET_ARN`.

Per-workspace bot tokens are stored separately under tenant-scoped secret paths
by the OAuth install flow. The existing Lambda execution role can read/write
`thinkwork/*` Secrets Manager paths, so no handler-specific IAM is needed for
the Slack rollout.

The handlers are inert stubs in the Terraform plumbing unit. Later plan units
add request signature verification, workspace OAuth install, event routing,
slash commands, interactivity, and outbound dispatch.
