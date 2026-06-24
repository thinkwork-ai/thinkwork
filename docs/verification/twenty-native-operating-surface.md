---
title: Twenty-native operating surface verification
linear: THNK-33
proof: crm_launch_resume_fallback
native_producer_verified: pending_app_sync
---

# Twenty-Native Operating Surface Verification

This checklist verifies the smallest user-visible THNK-33 proof: a native
Twenty app named `ThinkWork` exposes a `ThinkWork Webhook` logic function, the
app settings map the Twenty Opportunity `Customer` stage to a ThinkWork webhook,
and ThinkWork starts or resumes Customer Onboarding through that generic
webhook path.

It does not verify rich embedded panels or full native status writeback. Those
remain follow-up work after the app/action path is installed and visible.

## Preconditions

- Twenty managed app is running for the tenant.
- The `twenty` plugin is installed.
- The native app source at `plugins/twenty/twenty-app` has been synced to the
  target Twenty instance by an operator or deployment automation.
- Twenty Settings -> Applications -> Installed shows an app named `ThinkWork`
  with type `Local`, `NPM`, or `Tarball` from the Twenty app framework, not
  only an OAuth-only registration.
- The installed app Settings tab has secret `THINKWORK_WEBHOOK_URL` configured
  to the ThinkWork generic webhook URL from ThinkWork Settings -> Webhooks.
- The installed app Settings tab has `THINKWORK_TRIGGER_STAGE` set to
  `Customer`.
- The installed app includes the native `ThinkWork Webhook` logic function
  exposed as a workflow action.
- The `crm` MCP component is provisioned as the plugin-owned `twenty--crm`
  tenant MCP server.
- The verifying user has an active Twenty plugin activation.
- The plugin-owned Twenty MCP row has non-secret runtime metadata with
  Opportunity `recordLinkHints`; repair the row from Settings -> CRM after a
  plugin upgrade if an existing install predates the record-link hint release.
- A Customer Onboarding Space exists.
- A real or test Twenty Opportunity record can be moved to `Customer`.
- The Customer stage workflow calls the app action
  `ThinkWork -> ThinkWork Webhook`, not the built-in `HTTP_REQUEST` action.

## Verify

1. In Twenty Settings -> Applications -> Installed, confirm `ThinkWork` is
   visible and is not an OAuth-only compatibility row.
2. Open the ThinkWork app settings and confirm `THINKWORK_WEBHOOK_URL` is
   configured as a secret application variable.
3. Confirm `THINKWORK_TRIGGER_STAGE` is configured as `Customer`.
4. Confirm the Customer stage workflow action is `ThinkWork Webhook`, not
   built-in `HTTP_REQUEST`.
5. Move a test Opportunity to `Customer`.
6. Confirm the workflow run called the app logic function and capture the
   workflow run id.
7. Inspect ThinkWork generic webhook deliveries and confirm the payload includes
   `source=twenty-app`, `stage=Customer`, `triggerStage=Customer`, and the
   Opportunity id.
8. Confirm a ThinkWork Thread opens or is offered as the next action.
9. Repeat the same Opportunity transition or replay with the same idempotency
   key and confirm ThinkWork does not create duplicate work.
10. Inspect `crm_work_links` for one active row keyed by:

```text
tenant_id, provider=twenty, object_type=opportunity, object_id, workflow_key=customer_onboarding, outcome_key=default
```

11. Confirm the row has `last_writeback_state = blocked` and
    `failure_code = NATIVE_TWENTY_WRITEBACK_NOT_VERIFIED`.
12. Record redacted evidence in Linear: app id/registration id, workflow id,
    workflow run id, webhook delivery id, Opportunity id, Thread id, Goal id if
    present, and the replay/resume result.

## MCP Record-Link Proof

This proof verifies ad hoc agent/MCP access, not only the native app webhook
path. `tools/list`, OAuth metadata, `/healthz`, or a URL-shaped string are not
enough.

1. Confirm the deployed ThinkWork release includes the MCP record-link commits
   and the AgentCore Pi runtime image/deployment status is newer than those
   commits.
2. Confirm the verifying user has active Twenty MCP OAuth for the same tenant
   and agent that will run the proof.
3. For an already-installed Twenty plugin, use the managed repair/upgrade path
   rather than reinstalling from scratch, then confirm the same MCP row can
   produce links. This proves existing installs receive runtime metadata without
   a new OAuth grant.
4. Run `plugins/twenty/smoke/twenty-mcp-oauth-smoke.mjs` in live call mode:

```sh
SMOKE_ENABLE_TWENTY_MCP_OAUTH=1 \
  SMOKE_TWENTY_MCP_CALL=1 \
  SMOKE_TWENTY_USER_EMAIL=<twenty-user-email> \
  SMOKE_API_BASE_URL=<api-url> \
  SMOKE_COGNITO_ID_TOKEN=<current-user-id-token> \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_USER_ID=<user-id> \
  SMOKE_AGENT_ID=<agent-id> \
  node plugins/twenty/smoke/twenty-mcp-oauth-smoke.mjs
```

5. Require `opportunityProof.recordLinkProof.count > 0` and at least one
   `recordLinks[]` entry with `objectType=opportunity` and the managed Twenty
   origin. The smoke fails if the MCP proxy returns bare ids without
   `recordLinks`.
6. Open the generated URL as the authorized Twenty user and confirm it lands on
   the intended Opportunity. If an HTTP probe is preferable, set
   `SMOKE_TWENTY_VERIFY_RECORD_URL=1` with `SMOKE_TWENTY_WEB_COOKIE` or
   `SMOKE_TWENTY_WEB_AUTHORIZATION`.
7. Start a normal ThinkWork chat turn against the same agent and ask for the
   Opportunity. Confirm the final answer includes the generated Twenty URL and
   web/mobile chat renders it as a clickable link.
8. Preserve redacted evidence: release/deployment status, existing-install
   repair or upgrade action, smoke output showing `recordLinkProof`, opened
   Opportunity screenshot or URL-open evidence, and the chat/thread id. Do not
   paste raw MCP payloads beyond the intended final answer/link evidence.

## Blocker Evidence To Preserve

- If the app is not visible in Twenty Applications after sync, capture the
  Twenty CLI output and `core.application` / `core.applicationRegistration`
  sourceType rows before claiming the gate remains blocked.
- If the workflow still shows `HTTP_REQUEST`, capture the
  `wire-thinkwork-workflow.mjs --dry-run` output showing the target workflow
  version, selected step, and missing draft/apply prerequisite.
- Actual Twenty-side status writeback must not be claimed from the workflow
  action alone. It requires deployed Twenty runtime proof and tool/write
  capability evidence.
- The native app workflow action proves the app-to-webhook path, not rich
  embedded panels or full writeback.
- Record-link proof must come from a current-user MCP tool result or agent
  turn. Do not accept `tools/list`, `/healthz`, stale runtime images, or
  manually guessed `/object/opportunity/<id>` URLs as proof.
