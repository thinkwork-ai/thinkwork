---
module: authentication
problem_type: migration
tags: [cognito, oauth, oidc, workos, cutover]
---

# Cognito-native authentication cutover

This runbook moves a deployed stage from WorkOS coexistence to Cognito-native
local password, Google OIDC, an exact default-directory Microsoft OIDC route,
and separately named tenant Entra OIDC routes. The
login UI can publish native buttons while the WorkOS callback/bridge remains an
unpublished rollback seam. Do not run the destructive retirement migration
until every gate below has passed.

## Phase 1: coexistence

1. Deploy with `auth_retirement_phase = "coexistence"`. Publish native routes
   only after provider reconciliation reports exact Cognito configuration.
2. Complete the paginated WorkOS directory inventory and native identity proof
   backfill. Resolve every row to active, quarantined, revoked, or an explicit
   recovery path. Never promote an email-only match.
   For an active member whose prior identity is quarantined, issue the supported
   route-bound recovery flow:

   ```bash
   thinkwork enterprise auth-recovery \
     --stage <stage> \
     --tenant-id <tenant-uuid> \
     --user-id <user-uuid> \
     --redirect-uri https://<stage-host>/auth/callback
   ```

   Deliver the opaque link and one-time code through separate trusted channels.
   The operator does not supply a Cognito subject; the subject is bound only
   after the intended user signs in through an admitted route and consumes the
   challenge.

3. Exercise local password, Google, the exact default Microsoft directory, and each tenant-Entra route on
   web, mobile, desktop, and CLI. Verify login, refresh, restart/restore,
   logout, tenant selection, and realtime subscription admission.
4. Record the recovery deadline, support readiness, inventory fingerprint,
   maximum token lifetime, and maximum AppSync connection lifetime in the
   `auth_cutover_runs` record.

## Phase 2: cutover and drain

1. Deploy `auth_retirement_phase = "cutover"`. This keeps callback, bridge,
   logout, and custom-challenge code available for rollback but makes the
   WorkOS handler return HTTP 410 for every new authorize start.
2. Transition every legacy WorkOS-capable Cognito app client to `denied`, pass
   the same client IDs to `cognito_denied_app_client_ids`, and verify the
   pre-token trigger rejects password, custom-auth, code, and refresh issuance.
3. Globally sign out each distinct legacy Cognito username. Keep one controlled
   legacy refresh token and prove it is rejected.
4. Wait the longest deployed ID/access-token lifetime from the latest client
   shutdown, signout, accepted legacy request, callback, or bridge completion.
   Invalidate legacy AppSync subscriptions or wait the maximum connection
   lifetime. Reset the clock after any rollback or accepted legacy traffic.
5. Require zero pending bridges, active WorkOS sessions, accepted legacy
   audiences, legacy route traffic, WorkOS table reads/writes, compatibility
   fallback reads, and active legacy subscriptions for the full soak window.

## Phase 3: verify, finalize, retire

Deploy `auth_retirement_phase = "retired"` without finalization first. This
removes WorkOS routes, custom auth, and legacy clients while keeping the raw
tables and migration 0263 intact. Prepare the fingerprint-only inventory JSON
described in the operator runbook, then record a revision-bound live baseline:

```bash
THINKWORK_STAGE=<stage> \
THINKWORK_RELEASE_GIT_SHA=<full-deployed-git-sha> \
DATABASE_URL="$DATABASE_URL" \
COGNITO_USER_POOL_ID=<pool-id> \
THINKWORK_API_ID=<http-api-id> \
AUTH_CUTOVER_EVIDENCE=/secure/path/auth-cutover-inventory.json \
AUTH_CUTOVER_START_SOAK=true \
AUTH_CUTOVER_REQUIRED_SOAK_SECONDS=86400 \
bash scripts/verify-native-auth-cutover.sh
```

The verifier enforces 86,400 seconds as the minimum because AppSync GraphQL
WebSocket connections may live for 24 hours, longer than the legacy clients'
one-hour ID/access tokens. It also records `pg_stat_database.stats_reset`; an
epoch change or counter regression invalidates the soak and requires a fresh
full-duration baseline.

After the full duration, run the non-mutating live gate. It derives every
completion counter from AWS and Aurora and emits a short-lived Ed25519
attestation bound to the exact stage, cutover run, and deployed Git revision:

```bash
THINKWORK_STAGE=<stage> \
THINKWORK_RELEASE_GIT_SHA=<full-deployed-git-sha> \
DATABASE_URL="$DATABASE_URL" \
COGNITO_USER_POOL_ID=<pool-id> \
THINKWORK_API_ID=<http-api-id> \
AUTH_CUTOVER_EVIDENCE=/secure/path/auth-cutover-inventory.json \
AUTH_CUTOVER_SIGNED_EVIDENCE_OUTPUT=/secure/path/auth-cutover-attested.json \
bash scripts/verify-native-auth-cutover.sh
```

The command exits nonzero on any live mismatch and does not change the
database. It writes the attested envelope mode `0600`. Apply it before its
10-minute expiry; unsigned observation files, stale evidence, and evidence for
another stage or revision are rejected:

```bash
THINKWORK_STAGE=<stage> \
THINKWORK_RELEASE_GIT_SHA=<full-deployed-git-sha> \
DATABASE_URL="$DATABASE_URL" \
pnpm --filter @thinkwork/api exec tsx scripts/finalize-auth-cutover.ts \
  --evidence /secure/path/auth-cutover-attested.json --apply
```

Confirm the matching `auth_cutover_runs` row is `complete`. Only after the
recovery deadline and recorded soak have passed may the already-retired stage
deploy with:

- `thinkwork deploy --finalize-auth-retirement`

That explicit CLI flag admits migration 0263; a normal deploy skips it. The
retired Terraform phase removes WorkOS routes and the Cognito custom-auth
trigger. Retain only the immutable cutover and identity-proof evidence allowed
by the data-minimization policy.

## Immediate rollback triggers

Return publication and client lifecycle to the last proven coexistence state if
there is identity drift, duplicate usable accounts, wrong-tenant admission,
callback failure, refresh failure, unresolved inventory, or legacy traffic
during the soak. Record the rollback in the same cutover run and restart every
drain clock after the corrective deployment.
