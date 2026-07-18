# Cognito-native authentication cutover

This runbook retires the WorkOS login broker after local Cognito, Google,
Microsoft organizations, and tenant Entra routes have been proven in a deployed
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

## 2. Run the native matrix

For each web, mobile, desktop, and CLI client family, record these deployed
checks against the exact route-specific app client:

| Route                   | Required proof                                                           |
| ----------------------- | ------------------------------------------------------------------------ |
| Local Cognito           | sign-in, refresh, membership resolution, logout, refresh rejection       |
| Google                  | PKCE S256, Cognito token audience, refresh, logout/account choice        |
| Microsoft organizations | PKCE S256, Cognito token audience, refresh, logout/account choice        |
| Tenant Entra            | assigned tenant succeeds; another tenant and wrong directory fail closed |

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
2. Deny/delete every legacy WorkOS-capable Cognito app client and globally sign
   out the inventoried principals. Record every failure; the required count is
   zero.
3. Prove one controlled legacy refresh token is rejected and no new token can be
   minted.
4. Wait at least the configured maximum JWT lifetime after the last successful
   legacy mint.
5. Invalidate legacy realtime connections and wait the maximum connection
   lifetime. Confirm zero legacy subscription deliveries.
6. Observe a full soak window with zero WorkOS authorize/callback/bridge/logout
   traffic and zero reads/writes of `workos_auth_bridges` or
   `workos_auth_sessions`.

Rollback before the drain completes by restoring the preceding release and
route publication. After the final migration drops raw state, rollback requires
a new native enrollment; WorkOS session/profile data is intentionally not
archived.

## 4. Record completion evidence

Create a local, uncommitted JSON file from the observed results:

```json
{
  "inventoryFingerprint": "<64 lowercase hex characters>",
  "terminalDispositions": {
    "allTerminal": true,
    "unresolved": 0,
    "signoutFailures": 0,
    "compatibilityFallbackReads": 0
  },
  "clientShutdownEvidence": {
    "workosStartsEnabled": false,
    "legacyClientsEnabled": 0,
    "legacyAudiencesAccepted": 0
  },
  "drainEvidence": {
    "drainCompleted": true,
    "legacyRouteTraffic": 0,
    "workosTableReads": 0,
    "workosTableWrites": 0,
    "activeLegacySubscriptions": 0
  }
}
```

Validate, then persist it:

```bash
THINKWORK_STAGE=<stage> \
pnpm --filter @thinkwork/api auth:finalize-cutover -- --evidence /absolute/path/evidence.json

THINKWORK_STAGE=<stage> \
pnpm --filter @thinkwork/api auth:finalize-cutover -- --evidence /absolute/path/evidence.json --apply
```

Unknown fields and any nonzero/false gate are rejected.

## 5. Apply final cleanup

Apply `0263_drop_workos_auth_runtime.sql`. It takes an advisory lock and checks
the completion row again before mutation. It explicitly removes legacy
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
