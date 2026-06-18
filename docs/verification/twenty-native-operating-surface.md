---
title: Twenty-native operating surface verification
linear: THNK-33
proof: crm_launch_resume_fallback
native_producer_verified: false
---

# Twenty-Native Operating Surface Verification

This checklist verifies the smallest user-visible THNK-33 proof now present in
the app: a Twenty Opportunity launch handle opens ThinkWork, starts or resumes
Customer Onboarding, and records a durable CRM work link.

It does not verify rich Twenty embedded app packaging, Twenty logic-function
installation, or native Twenty-side status writeback. Those remain blocked until
deployed self-hosted Twenty app runtime support is proven.

## Preconditions

- Twenty managed app is running for the tenant.
- The `twenty` plugin is installed.
- The `crm` MCP component is provisioned as the plugin-owned `twenty--crm`
  tenant MCP server.
- The verifying user has an active Twenty plugin activation.
- A Customer Onboarding Space exists.
- A real or test Twenty Opportunity record has a launch handle that opens:

```text
https://<thinkwork-web-origin>/crm/twenty/opportunity/<opportunity-id>/customer_onboarding?opportunityUrl=<encoded-twenty-url>&companyName=<encoded-company-name>
```

## Verify

1. Open the launch handle from the Twenty Opportunity record.
2. Confirm the ThinkWork page shows the Opportunity id and optional Twenty URL.
3. Click **Start or resume**.
4. Confirm a ThinkWork Thread opens or is offered as the next action.
5. Repeat the launch from the same Opportunity and confirm it resumes the same
   Thread/Goal instead of creating duplicate work.
6. Inspect `crm_work_links` for one active row keyed by:

```text
tenant_id, provider=twenty, object_type=opportunity, object_id, workflow_key=customer_onboarding, outcome_key=default
```

7. Confirm the row has `last_writeback_state = blocked` and
   `failure_code = NATIVE_TWENTY_WRITEBACK_NOT_VERIFIED`.
8. Record redacted evidence in Linear: Opportunity id, Thread id, Goal id if
   present, the launch URL shape, and the resume result.

## Blocker Evidence To Preserve

- The current Twenty plugin manifest does not package a Twenty app, front
  component, or logic-function producer.
- Actual Twenty-side status writeback must not be claimed from the fallback
  route. It requires deployed Twenty runtime proof and tool/write capability
  evidence.
- The fallback proves CRM-record launch/resume continuity, not
  `native_producer_verified`.
