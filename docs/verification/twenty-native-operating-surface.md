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
