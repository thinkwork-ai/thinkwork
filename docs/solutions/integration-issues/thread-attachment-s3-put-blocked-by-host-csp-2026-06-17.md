---
title: Thread attachment S3 PUTs need S3 in the web host CSP
date: 2026-06-17
category: integration-issues
module: terraform/modules/thinkwork
problem_type: integration_issue
component: browser_uploads
severity: high
symptoms:
  - "Thread composer shows: Upload failed (put): Failed to fetch"
  - "Presign succeeds, then browser-side direct S3 PUT fails before finalize"
  - "The same failure appears on customer-domain deployments such as tei.thinkwork.ai and mcpherson.thinkwork.ai"
root_cause: missing_csp_connect_source
resolution_type: code_fix
related_components:
  - apps/web
  - packages/api
  - terraform/modules/data/s3-buckets
tags:
  - thnk-36
  - csp
  - s3
  - attachments
  - customer-domains
  - terraform
---

# Thread attachment S3 PUTs need S3 in the web host CSP

## Problem

Thread attachment upload uses a browser-side presign -> PUT -> finalize flow:

1. `apps/web/src/lib/upload-thread-attachments.ts` calls
   `POST /api/threads/{threadId}/attachments/presign`.
2. `packages/api/src/handlers/thread-attachments-presign.ts` returns a
   presigned S3 `signedPutUrl`.
3. The browser calls `fetch(signedPutUrl, { method: "PUT", ... })`.
4. The web app calls
   `POST /api/threads/{threadId}/attachments/finalize`.

On THNK-36, the composer showed `Upload failed (put): Failed to fetch` on
`https://tei.thinkwork.ai/activity/9f793ee2-c5f3-493b-938a-1c8365fdbee7`.
Eric then reproduced the same failure on `https://mcpherson.thinkwork.ai`.

The stage label matters: `put` means the presign API call completed and the
browser failed while connecting to the returned S3 URL. The failure is before
finalize and before the agent analysis path.

## Evidence

- `curl -I https://tei.thinkwork.ai/` returned a host CSP with this
  `connect-src`:

  ```text
  connect-src 'self'
    https://*.execute-api.us-east-1.amazonaws.com
    https://*.appsync-api.us-east-1.amazonaws.com
    wss://*.appsync-realtime-api.us-east-1.amazonaws.com
    https://cognito-idp.us-east-1.amazonaws.com
    https://*.auth.us-east-1.amazoncognito.com
  ```

- `curl -I https://mcpherson.thinkwork.ai/` returned the same relevant CSP.
- The TEI workspace bucket CORS allows browser PUTs:

  ```json
  {
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedOrigins": ["*"],
    "AllowedHeaders": ["Authorization", "x-amz-*", "Content-Type"]
  }
  ```

- TEI API Gateway OPTIONS for the attachment presign route returns 204 with
  CORS headers, so the API preflight path is not the blocking link.
- The Terraform source in `terraform/modules/thinkwork/main.tf` generated the
  deployed host CSP and did not include regional S3 endpoints in `connect-src`.

## Root Cause

The web host CSP was written before thread attachments used direct browser S3
PUTs. It allowed API Gateway, AppSync, Cognito IdP, and Cognito Hosted UI, but
not S3.

When the attachment helper receives a presigned URL such as:

```text
https://<workspace-bucket>.s3.us-east-1.amazonaws.com/...
```

the browser enforces the page's `connect-src` before making the network request.
Because S3 is absent from `connect-src`, the browser rejects the request and
the web helper catches it as `TypeError: Failed to fetch`, which the composer
surfaces as `Upload failed (put): Failed to fetch`.

This is not an S3 bucket CORS failure on the observed environments: CORS is
already permissive enough for PUT. CORS would still matter after CSP permits the
connection, but it is not the first failing gate here.

## Fix Plan

Update the Terraform-installed web host CSP so `connect-src` allows the
regional S3 endpoints used by presigned workspace-bucket URLs:

```text
https://*.s3.${var.region}.amazonaws.com
https://s3.${var.region}.amazonaws.com
```

Keep this scoped to `connect-src`; do not broaden `script-src`, `worker-src`,
or sandbox iframe CSP. Attachment uploads need browser connectivity to S3, not
execution authority from S3.

## Verification

For the repo fix:

- Run the Terraform fixture test that asserts the host CSP includes S3.
- Run `terraform fmt -check terraform/modules/thinkwork/main.tf`.
- Run Prettier on the touched TypeScript test.

For deployed environments:

1. Apply or release the Terraform change to each affected environment.
2. Confirm `curl -I https://<customer-domain>/` includes
   `https://*.s3.<region>.amazonaws.com` in `content-security-policy`.
3. Upload a spreadsheet from the affected customer domain and confirm the
   upload reaches finalize instead of failing at `put`.
4. If a later failure appears, debug it as a new stage-specific issue
   (`finalize` would point at server-side validation or S3 object reads).

## Prevention

Any future browser direct-to-object-store flow must update both policy layers:

- Bucket CORS must allow the browser method and headers.
- The web host CSP must allow the object-store endpoint in `connect-src`.

Direct `curl` checks are not enough for this class because curl does not enforce
browser CSP. Always inspect the deployed page headers or perform a browser
upload smoke.
