# compliance-audit-bucket

WORM-protected S3 bucket for SOC2 Type 1 tamper-evident audit anchoring. Provisions the bucket that the anchor Lambda (U8a/U8b) writes Merkle-anchor evidence into, and ships the IAM role the Lambda will eventually assume.

Module path: `terraform/modules/data/compliance-audit-bucket/` (master-plan canonical name).
Bucket name: `thinkwork-${var.stage}-compliance-anchors` (master plan line 513 — plural, distinct from the module name).

## What this is

- An S3 bucket with Object Lock enabled at create time. Object Lock cannot be disabled after creation; this is a one-way commitment per AWS.
- Two prefixes:
  - `anchors/` — Merkle-anchor objects. Subject to default retention. Lifecycle transitions to Glacier IR at 90 days. **No** expiration rule.
  - `proofs/` — per-tenant proof slices written by the anchor Lambda. The bucket-level Lock applies, but U8b sets a shorter per-object retention because slices are derivable from the chain + anchor.
- A bucket policy denying any `s3:*` over plain HTTP and denying `s3:DeleteObject` / `s3:DeleteObjectVersion` from any principal — defense-in-depth on top of Object Lock.
- An IAM role (`thinkwork-${stage}-compliance-anchor-lambda-role`) that U8a's anchor Lambda will assume. The role's inline policy is path-scoped to `anchors/*` and `proofs/*`, grants only the actions the writer needs, and **explicitly denies** `s3:BypassGovernanceRetention` and `s3:PutObjectLegalHold` so the deny survives any future broadening of the role's IAM grants.

## Object Lock posture

| Stage | Default `mode` | Default retention | Notes |
|-------|----------------|-------------------|-------|
| dev / staging | `GOVERNANCE` | 365 days | Allows a privileged role with `s3:BypassGovernanceRetention` to delete or shorten retention. Required for dev iteration; the anchor Lambda role itself does **not** hold the bypass action (explicitly denied). |
| prod (audit-engagement time) | `COMPLIANCE` | 365 days | Irreversible — even AWS root cannot delete or shorten retention until it expires. |

### COMPLIANCE-mode cutover playbook (prod)

The flip is a one-line tfvars change in the prod stack at audit-engagement time:

```hcl
# terraform/examples/greenfield/terraform.tfvars (prod)
compliance_anchor_object_lock_mode = "COMPLIANCE"
```

After `terraform apply`, verify with:

```bash
aws s3api get-object-lock-configuration \
  --bucket thinkwork-prod-compliance-anchors \
  --query 'ObjectLockConfiguration.Rule.DefaultRetention.Mode'
# Expected: "COMPLIANCE"
```

Once flipped to COMPLIANCE, the bucket's default retention cannot be shortened by any principal, including AWS root. The flip itself is reversible by Terraform plan only until the first object is written; after that, AWS retains the lock state for the full retention window regardless of subsequent configuration changes.

## `force_destroy = false` invariant

`force_destroy` is hardcoded `false`. Object Lock + `force_destroy` interact pathologically:

- **COMPLIANCE mode:** `terraform destroy` cannot delete locked objects until retention expires (365 days). `force_destroy = true` would fail with `AccessDenied (403 Forbidden)` on every object.
- **GOVERNANCE mode:** `force_destroy = true` would only succeed if the deploying principal holds `s3:BypassGovernanceRetention`, which we explicitly do not grant. Granting it would defeat the audit-evidence posture.

Either way, `force_destroy = true` masks Object Lock retention behavior. Don't ship it.

### Dev cleanup playbook

> **U8b cutover note (2026-05-07):** the anchor Lambda now writes real WORM-locked
> bytes on every 15-minute cadence. A dev bucket that's been live for any non-trivial
> period accumulates objects under default 365-day retention — the dev stage's
> `GOVERNANCE` mode is the *only* thing that makes this playbook achievable. The
> `proofs/` prefix relies on the bucket-default lock; both anchor and proof objects
> require the bypass action below to delete. **Do not run this playbook against a
> COMPLIANCE-mode bucket** (prod) — the `s3:BypassGovernanceRetention` action is
> ineffective and the only recovery is rotating the bucket name on a fresh stage.

Tearing down a dev bucket requires admin-tier intervention (not a routine operator action) and is **not supported by `terraform destroy` alone**. The repo does not currently provision a break-glass role with `s3:BypassGovernanceRetention`; the operator performs the cleanup using their own admin credentials (or grants themselves the bypass action ad-hoc via an IAM policy attachment for the duration of the cleanup, then revokes it).

1. **Pre-requisite**: confirm your active credentials hold both `s3:BypassGovernanceRetention` AND `s3:DeleteObjectVersion` on the bucket. The anchor Lambda role itself **does not** hold these — it is explicitly Denied. If your admin role lacks them, attach a temporary inline policy:
   ```bash
   aws iam put-role-policy --role-name <your-admin-role> \
     --policy-name compliance-anchor-bypass-temp \
     --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:BypassGovernanceRetention","s3:DeleteObjectVersion","s3:DeleteObject"],"Resource":"arn:aws:s3:::thinkwork-dev-compliance-anchors/*"}]}'
   ```
2. Empty the bucket with the bypass flag (the bucket policy still denies `s3:DeleteObject` from any principal — see "Bucket-policy interaction" below before running this):
   ```bash
   # First, you'll need to remove the DenyDeleteObject statement from the
   # bucket policy temporarily. See Step 3 of "Bucket-policy interaction".
   aws s3api list-object-versions --bucket thinkwork-dev-compliance-anchors \
     --query '{Objects: Versions[].{Key: Key, VersionId: VersionId}}' \
     | aws s3api delete-objects --bucket thinkwork-dev-compliance-anchors \
       --bypass-governance-retention --delete file:///dev/stdin
   # Repeat for delete markers if any (DeleteMarkers in list-object-versions output).
   ```
3. Delete the bucket:
   ```bash
   aws s3api delete-bucket --bucket thinkwork-dev-compliance-anchors
   ```
4. Wait at least 1 hour before recreating with the same name (S3 bucket-name reuse latency).
5. If `terraform apply` is impatient, `terraform state rm module.compliance_anchors.aws_s3_bucket.anchor` to avoid the recreate-failure loop.
6. Revoke the temporary policy from step 1: `aws iam delete-role-policy --role-name <your-admin-role> --policy-name compliance-anchor-bypass-temp`.

#### Bucket-policy interaction

This module's bucket policy includes a `DenyDeleteObject` statement that applies to **all principals**, including admin roles with `s3:BypassGovernanceRetention`. To complete the dev cleanup, you must temporarily replace the bucket policy with one that omits the `DenyDeleteObject` statement (or attaches a Condition exempting your admin role):

```bash
# 1. Save the current policy
aws s3api get-bucket-policy --bucket thinkwork-dev-compliance-anchors \
  --query Policy --output text > /tmp/anchor-bucket-policy-backup.json

# 2. Replace with a permissive policy (delete-allow only — keep EnforceHTTPS)
aws s3api put-bucket-policy --bucket thinkwork-dev-compliance-anchors \
  --policy '{"Version":"2012-10-17","Statement":[{"Sid":"EnforceHTTPS","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::thinkwork-dev-compliance-anchors","arn:aws:s3:::thinkwork-dev-compliance-anchors/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}'

# 3. Now run the empty-bucket commands from the main playbook
# 4. After delete, the policy is gone with the bucket — no restore needed.
```

This playbook applies only to GOVERNANCE-mode buckets. COMPLIANCE-mode buckets cannot be emptied until retention expires — by design.

## KMS dependency

This module is **the org's first real consumer** of `module.kms.aws_kms_key.main` (the `alias/thinkwork-${stage}` CMK). The default key policy uses the standard "root account" statement, which permits any same-account principal whose IAM policy allows the action — the anchor Lambda role's inline policy fully covers this.

If a future PR tightens the KMS key policy without explicitly naming the anchor Lambda role, anchor writes will start failing with `KMSAccessDenied` at runtime — the failure mode is silent (no Terraform plan diff). The variable-level validation and resource-level `lifecycle.precondition` on the SSE configuration catch a missing `kms_key_arn` at plan time, but they cannot catch a key-policy regression. U8b's smoke test exercises the full Put/Get path and is the primary integration check.

## Provider pin

This module is compatible with the repo-wide `hashicorp/aws ~> 5.0` pin (locked to `5.100.0` in `terraform/examples/greenfield/.terraform.lock.hcl`). The `aws_s3_bucket_object_lock_configuration` standalone resource (current shape; not the deprecated inline `object_lock_configuration` block on `aws_s3_bucket`) has been stable since v4.0 (Feb 2022 split-resource refactor).

## Inputs

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `stage` | string | _required_ | Deployment stage (e.g., `dev`, `prod`). Stages `prod` and `production` enforce `mode = "COMPLIANCE"` via Terraform `precondition`. |
| `account_id` | string | _required_ | AWS account ID. Used as `aws:SourceAccount` condition on the anchor Lambda role's trust policy (confused-deputy defense). |
| `bucket_name` | string | _required_ | Bucket name. Master-plan canonical: `thinkwork-${stage}-compliance-anchors`. |
| `kms_key_arn` | string | _required_ | CMK ARN for SSE-KMS. Wired from `module.kms.key_arn` at the composite root. Validated non-empty. |
| `mode` | string | `"GOVERNANCE"` | Object Lock retention mode. Validated ∈ {`GOVERNANCE`, `COMPLIANCE`}. Production stages reject `GOVERNANCE` via plan-time `precondition`. |
| `retention_days` | number | `365` | Default retention in days. Validated > 0. |

## Outputs

| Output | Description |
|--------|-------------|
| `bucket_name` | Bucket id (= `var.bucket_name`). |
| `bucket_arn` | Bucket ARN. |
| `lambda_role_arn` | IAM role ARN the anchor Lambda will assume (inert in U7 — U8a wires the function). |

## See also

- Master plan: `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U7 entry).
- U7 sub-plan: `docs/plans/2026-05-07-009-feat-compliance-u7-anchor-bucket-plan.md`.
- U8a sub-plan: `docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md` (inert seam).
- U8b sub-plan: `docs/plans/2026-05-07-012-feat-compliance-u8b-anchor-lambda-live-plan.md` (live S3 PutObject + Object Lock retention).
- AWS S3 Object Lock: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-overview.html>.
- Cohasset Associates Compliance Assessment: <https://d1.awsstatic.com/r2018/b/S3-Object-Lock/Amazon-S3-Compliance-Assessment.pdf>.
