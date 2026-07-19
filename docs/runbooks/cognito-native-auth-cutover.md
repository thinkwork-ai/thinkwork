# Cognito-native authentication cutover

This runbook retires the WorkOS login broker after local Cognito, Google,
the exact default Microsoft directory, and tenant Entra routes have been proven in a deployed
stage. It does not cover WorkOS used as an OAuth authorization server by an
unrelated MCP integration.

Never manufacture zero-valued evidence. Migration `0263` is intentionally
blocked until the observations below have completed in the target stage.

## 1. Inventory every identity

Run the inventory while the WorkOS API key and the legacy session tables still
exist. Dry-run first:

```bash
COGNITO_USER_POOL_ID=<pool-id> \
AWS_REGION=<region> \
THINKWORK_STAGE=<stage> \
WORKOS_API_KEY=<read-capable-key> \
pnpm --filter @thinkwork/api auth:inventory
```

The command paginates all Cognito users and `GET
/user_management/users` from WorkOS, correlates WorkOS users through the exact
stored WorkOS-user/Cognito-sub binding, and prints counts plus SHA-256 digests
only. It must report `workosDirectoryComplete: true` and every active/recent
identity must be mapped or explicitly quarantined. Apply the reviewed inventory
with the same environment and `--apply`.

Do not proceed when either `unresolved` or `workosUnresolved` is nonzero. Resolve
each collision through the native identity enrollment/proof flow; never use an
email match as authorization.

For an active member with a quarantined identity, use the supported operator
flow instead of editing identity rows:

```bash
thinkwork enterprise auth-recovery \
  --stage <stage> \
  --tenant-id <tenant-uuid> \
  --user-id <user-uuid> \
  --redirect-uri https://<stage-host>/auth/callback
```

Send the opaque recovery link and the 8-digit code through separate trusted
channels. The operator cannot choose the replacement Cognito subject. It is
bound only when the intended user authenticates through an admitted Cognito
route and consumes the exact challenge.

## 2. Run the native matrix

For each web, mobile, desktop, and CLI client family, record these deployed
checks against the exact route-specific app client:

| Route                       | Required proof                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Local Cognito               | sign-in, refresh, membership resolution, logout, refresh rejection                     |
| Google                      | PKCE S256, Cognito token audience, refresh, logout/account choice                      |
| Default Microsoft directory | Exact tenant issuer, PKCE S256, Cognito token audience, refresh, logout/account choice |
| Tenant Entra                | assigned tenant succeeds; another tenant and wrong directory fail closed               |

Also verify invite and pending-owner enrollment on web and mobile. Capture only
request IDs, counts, timestamps, route keys, and hashed principals—never tokens,
codes, session IDs, emails, or provider profiles.

Paid first-owner provisioning must create an inert user plus `pending`
membership, then require the opaque `/accept-invite` link and separately shown
8-digit challenge. Verify local Cognito, Google, and Microsoft can each consume
that exact enrollment and that an email match alone cannot expose
`pendingClaim`, call `bootstrapUser`, or activate ownership. A failed welcome
email must release the Stripe event claim; the retry must rotate the enrollment
without creating a second tenant. Self-hosted deploys instead bind the exact
Cognito `sub` returned by `admin-create-user`/`admin-get-user`.

## 3. Disable and drain WorkOS

1. Confirm the deployed public options endpoint publishes no WorkOS route.
2. Deploy `auth_retirement_phase = "cutover"`, globally sign out the
   inventoried principals, and prove one controlled legacy refresh token is
   rejected. Record every failure; the required count is zero.
3. Wait at least the configured maximum JWT lifetime after the last successful
   legacy mint.
4. Invalidate legacy realtime connections and wait the maximum connection
   lifetime. Confirm zero legacy subscription deliveries.
5. Deploy `auth_retirement_phase = "retired"` **without**
   `--finalize-auth-retirement`. This removes the WorkOS routes, custom-auth
   trigger, and legacy Cognito clients while deliberately retaining the
   historical database tables and evidence-gated migration.
6. Observe a full soak window with zero WorkOS authorize/callback/bridge/logout
   traffic and zero reads/writes of `workos_auth_bridges` or
   `workos_auth_sessions`.

Rollback before the drain completes by restoring the preceding release and
route publication. After the final migration drops raw state, rollback requires
a new native enrollment; WorkOS session/profile data is intentionally not
archived.

## 4. Record completion evidence

Create a local, uncommitted inventory reference. Operator-supplied completion
predicates are intentionally not accepted:

```json
{
  "inventoryFingerprint": "<64 lowercase hex characters>"
}
```

Start the revision-bound soak only after the retired infrastructure deployment.
This mode records the live Aurora table-statistics baseline and the required
duration on the matching cutover run:

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

`86400` seconds is the enforced minimum, not an operator-tunable shortcut. The
legacy ID/access-token maximum is one hour, while AWS AppSync GraphQL
[automatically closes WebSocket connections after 24 hours](https://docs.aws.amazon.com/appsync/latest/devguide/real-time-websocket-client.html).
Longer soak windows are allowed; shorter values fail before the baseline is
written.

After the full duration has elapsed, run the live verifier again against the
same deployed Git revision. It independently reads AWS routes/clients and
database counters, requires zero delta from the stored baseline, and writes a
short-lived stage/revision-bound Ed25519 envelope:

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

The baseline also records `pg_stat_database.stats_reset`. The final verifier
requires that epoch to be unchanged and rejects any table counter regression.
A PostgreSQL statistics reset, Aurora failover that resets statistics, or lower
counter value invalidates the soak; start a fresh full-duration soak.

The completion verifier is read-only and the output file is mode `0600`.
Before its 10-minute expiry, persist the attested result:

```bash
THINKWORK_STAGE=<stage> \
THINKWORK_RELEASE_GIT_SHA=<full-deployed-git-sha> \
DATABASE_URL="$DATABASE_URL" \
pnpm --filter @thinkwork/api auth:finalize-cutover -- \
  --evidence /secure/path/auth-cutover-attested.json --apply
```

Unknown fields, unsigned observations, stale evidence, wrong-stage or
wrong-revision evidence, an incomplete soak, and any nonzero/false live gate
are rejected. The finalizer also requires the locked cutover row to still be in
`soaking` state.

## 5. Apply final cleanup

Run the retired deployment again with `thinkwork deploy
--finalize-auth-retirement`. That explicit flag admits
`0263_drop_workos_auth_runtime.sql`; ordinary deploys always skip it. The
migration takes an advisory lock and checks the completion row again before
mutation. It explicitly removes legacy
identities/references/routes/plugin rows, drops the two raw WorkOS tables, and
narrows lifecycle/component constraints; it never uses `CASCADE`.

On a genuinely clean installation, the migration may drop empty historical
tables without fictional cutover evidence. Any WorkOS row, coexistence route,
or legacy plugin install restores the full evidence requirement.

After the database migration succeeds:

1. List Secrets Manager/SSM values under the stage's retired
   `thinkwork/<stage>/plugin-auth/` WorkOS namespace.
2. Verify each target belongs to the retired WorkOS login plugin, then schedule
   deletion using the organization's recovery window. Do not delete connector
   OAuth secrets from unrelated MCP integrations.
3. Run Terraform plan twice. The first plan must remove only legacy
   WorkOS/custom-auth resources; after apply, the second plan must be empty.
4. Re-run the complete native matrix and repository/deployed-state search.

Historical plans, solutions, migrations 0173–0175, and audit/release records are
retained as history; they are not supported runtime surfaces.
