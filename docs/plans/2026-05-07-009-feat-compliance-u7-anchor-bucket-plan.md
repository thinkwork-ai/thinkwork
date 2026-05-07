---
title: "feat: Compliance U7 — S3 Object Lock anchor bucket Terraform module"
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# feat: Compliance U7 — S3 Object Lock anchor bucket Terraform module

## Summary

Ship the WORM-anchored S3 substrate that U8a/U8b will write Merkle-anchor evidence into. Greenfield Object Lock for this repo (zero prior art). New Terraform module at `terraform/modules/data/compliance-audit-bucket/` (master-plan-canonical name; the bucket it provisions is `thinkwork-${stage}-compliance-anchors`) mirroring the `s3-backups-bucket` pattern. Object Lock enabled at create time, GOVERNANCE-mode default (master plan Decision #2 — Compliance flip is a one-line tfvars change at audit-engagement time), 365-day default retention, SSE-KMS via the existing thinkwork CMK (this is the org's first real KMS consumer), `anchors/` + `proofs/` prefix architecture (Lock applies bucket-wide; `proofs/` writes set per-object retention to bypass via U8b — documented but enforced later), bucket-level deny on `s3:DeleteObject` (defense-in-depth), HTTPS-only enforcement, and a co-located IAM role for the future anchor Lambda with **explicit Deny** on `s3:BypassGovernanceRetention` and `s3:PutObjectLegalHold`. Wired through the standard `data → thinkwork → app/lambda-api` three-tier plumbing. **Inert in this PR** — the IAM role exists but no Lambda assumes it until U8a.

---

## Problem Frame

Master-plan-U2 already gives `compliance.audit_events` a per-tenant hash chain. Hashes alone aren't tamper-evident — anyone with DB write access could rewrite both rows and recompute hashes. U8a/b will write Merkle anchors out to a WORM-protected S3 bucket every 15 minutes; the anchor object's `LastModified` + Object Lock retention is what makes the chain genuinely tamper-evident to an outside auditor. U7 ships that bucket and its supporting IAM so U8 can wire the Lambda body without also having to negotiate Object Lock semantics, KMS plumbing, prefix architecture, and three-tier Terraform variable threading in the same PR.

---

## Requirements

- R1. New Terraform module at `terraform/modules/data/compliance-audit-bucket/` creates an S3 bucket named `thinkwork-${var.stage}-compliance-anchors` with Object Lock enabled at creation. (Master plan U7 line 509, line 513)
- R2. Default retention is GOVERNANCE mode, 365 days, parameterized so a future PR can flip to COMPLIANCE in prod without recreating the bucket. (Master plan Decision #2)
- R3. Versioning is `Enabled` (Object Lock prerequisite); never Suspended. Public access fully blocked. SSE-KMS using the existing thinkwork CMK, with `bucket_key_enabled = true`. (Master plan Decision #2 + AWS Object Lock requirements)
- R4. Lifecycle transitions: Standard → Glacier Instant Retrieval at 90 days, scoped to `prefix = "anchors/"` (the WORM-protected anchor objects). **No** expiration rules (Object Lock retention is the deletion gate). Noncurrent versions transition to Glacier IR after 90 days. (Master plan U7)
- R5. IAM role (`thinkwork-${var.stage}-compliance-anchor-lambda-role`) co-located in the module with two inline statements:
  - **Allow** object-side `s3:PutObject` + `s3:PutObjectRetention` + `s3:GetObject` + `s3:GetObjectRetention` on `${bucket_arn}/anchors/*` and `${bucket_arn}/proofs/*` only (path-scoped per master plan line 517).
  - **Allow** bucket-side `s3:GetBucketObjectLockConfiguration` on `${bucket_arn}`.
  - **Allow** CMK-scoped `kms:GenerateDataKey` + `kms:Decrypt` + `kms:DescribeKey`.
  - **Explicit Deny** `s3:BypassGovernanceRetention` and `s3:PutObjectLegalHold` on `${bucket_arn}/*` (master plan line 517 — explicit deny, not just absence-of-allow, so the deny survives a future broadening of the role's IAM grants).
  (Master plan U7 + Decision #2)
- R6. Module outputs `bucket_arn`, `bucket_name`, `lambda_role_arn`. Composite root re-exports `compliance_anchor_bucket_arn`, `compliance_anchor_bucket_name`, `compliance_anchor_lambda_role_arn`. (R6 is partially satisfied by U1 — `bucket_arn` + `bucket_name` — and completed by U2 — `lambda_role_arn`.)
- R7. App tier (`terraform/modules/app/lambda-api/variables.tf`) declares the three values as inert variables (`default = ""`) so U8a's anchor Lambda has variable shape ready without forcing this PR to wire a Lambda body. (Master plan Decision #9 — inert→live seam swap)
- R8. Bucket-level `aws_s3_bucket_policy` carries two Deny statements: (a) `aws:SecureTransport = false` (TLS-only — mirrors `terraform/modules/data/s3-backups-bucket/main.tf:85-113`); (b) `s3:DeleteObject` + `s3:DeleteObjectVersion` from any principal (master plan line 518 — defense-in-depth on top of Object Lock). The IAM role's allow grants do not include Delete, so this policy never blocks the legitimate write path.
- R9. Module variables carry validation blocks: `mode` ∈ {GOVERNANCE, COMPLIANCE}; `retention_days > 0`; `kms_key_arn` non-empty. The SSE configuration resource carries a `lifecycle.precondition { condition = var.kms_key_arn != "" }` to fail at plan time if the KMS chain breaks (master plan line 520 — Terraform precondition for typo-defense). (Master plan U7)
- R10. `terraform plan` against the dev stage shows zero diff after one apply (no provider drift); `terraform validate` passes; post-deploy AWS-CLI smoke confirms `aws s3api get-object-lock-configuration --bucket thinkwork-dev-compliance-anchors` returns `Mode: GOVERNANCE`, `Days: 365`. (Master plan U7 verification)
- R11. `force_destroy` is **never** set in prod and is hardcoded `false` even in dev for the anchor bucket — Object Lock + force_destroy is incompatible by design and would mask retention failures during teardown. Document the operational caveat in the module README. (AWS guidance + master plan Decision #2)

---

## Scope Boundaries

- Anchor Lambda implementation (handler, packaging, EventBridge schedule, watchdog alarm) — that's U8a/U8b.
- Audit-verifier CLI (read-side of the anchor bucket) — U9.
- Admin Compliance UI (anchor-status badges, verification-status panel) — U10.
- Async export job + presigned-URL flow — U11.
- Cross-region replication of the anchor bucket. Master plan defers; not in U7.
- AWS Backup or S3 Inventory integration — the master plan does not require it for SOC2 Type 1 evidence-foundation.
- Switching to COMPLIANCE mode for prod. The module exposes the variable; the actual `mode = "COMPLIANCE"` flip happens at audit-engagement time via a separate one-line tfvars change PR. The verification step in this PR confirms GOVERNANCE.

### Deviations from Master Plan U7 (deferred, documented)

The following master-plan-U7 items are intentionally deferred from this PR:

- **Separate KMS key + alias `alias/thinkwork-${stage}-compliance-anchors`** (master plan line 515). Reusing the existing thinkwork CMK keeps key sprawl at zero for v1; U7 is the first real consumer of that key, so any "should we have a dedicated CMK?" conversation is better scoped against actual operational evidence than against an empty bucket. A dedicated key + alias becomes a follow-up PR if the SOC2 auditor flags shared-CMK usage.
- **Server access logging to a separate logging bucket prefix `compliance-anchor-access-logs/`** (master plan line 516). CloudTrail object-level events provide equivalent audit trail for SOC2 Type 1 (the auditor's question is "is bucket access logged?", which CloudTrail answers); enabling S3 server access logs is additive defense-in-depth that the master plan can require independently. Deferred to a follow-up PR if the auditor specifically asks for native S3 server logs.
- **GOVERNANCE → COMPLIANCE prod flip**: a one-line tfvars change in the prod stack at audit-engagement time. Not part of U7.
- **Post-365-day anchor disposition**: when retention expires, anchors become deletable but no expiration rule fires — the bucket grows ~35k objects/year/stage indefinitely. The auditor question "how is post-retention metadata disposed?" doesn't have a U7 answer. Add a noncurrent + expired-current expiration rule in a follow-up after auditor guidance shapes the retention story.

### Deferred to Follow-Up Work

- COMPLIANCE-mode prod cutover: a one-line tfvars change in the prod stack at audit-engagement time.
- Separate KMS key + alias (see deviations above).
- Server access logging (see deviations above).
- Post-retention object disposition rule (see deviations above).
- Bucket-policy `s3:object-lock-remaining-retention-days` minimum/maximum guard — useful when a per-object retention override is on the menu. U8b sets per-object retention to the bucket default; the guard becomes meaningful once the Lambda starts varying retention per anchor.

---

## Context & Research

### Relevant Code and Patterns

- `terraform/modules/data/s3-backups-bucket/main.tf` — closest existing analog. Mirror its module shape (single `main.tf` with `aws_s3_bucket` + `_public_access_block` + `_versioning` + `_server_side_encryption_configuration` + `_lifecycle_configuration` + `_policy`), tag block (`Name`/`Stage`/`Purpose`), `bucket_arn`/`bucket_name` outputs, and the `EnforceHTTPS` Deny bucket-policy idiom (lines 85-113). The bucket-policy `depends_on` on the public-access-block is the canonical race-avoidance pattern.
- `terraform/modules/data/aurora-postgres/` — IAM role + inline policy idiom (`aws_iam_role` with inline `assume_role_policy` JSON for `lambda.amazonaws.com` + separate `aws_iam_role_policy` resources). Inline policies are preferred over managed policies in this repo.
- `terraform/modules/foundation/kms/main.tf:25-49` — canonical CMK is `module.kms.aws_kms_key.main` (count-gated; address `aws_kms_key.main[0]` inside the submodule). Exposes `key_arn` and `key_id` outputs. **U7 will be the first real consumer** of this key — no existing module references `module.kms.key_arn` today, and no existing IAM policy grants `kms:GenerateDataKey` or `kms:Decrypt`. The default key policy's root-account statement is sufficient for same-account IAM-permitted access; if a future PR tightens that policy without naming the anchor role, anchor writes will 403 silently. Flagged in Risks.
- `terraform/modules/thinkwork/main.tf:14, 116-121, 147-148` — three-tier pass-through example (backups bucket): submodule output → composite-root local → forwarded as variable into a downstream module. Mirror this exactly for the compliance anchor outputs.
- `terraform/modules/app/lambda-api/variables.tf:183-193, 411-415` — inert variable pattern: `default = ""` with explicit "Default empty until X is provisioned" comment. This is the shape U7 needs for the three new variables in lambda-api. Note: existing inert variables (e.g., `agentcore_function_arn`) are referenced by `count`-gated resource blocks; U7's three variables will be declared but not yet referenced anywhere — pure shape reservation. The plan accepts this as the trade-off for landing the bucket and the U8a wiring as separate atomic PRs.
- `terraform/modules/app/sandbox-log-scrubber/main.tf:89-100` and `terraform/modules/app/job-triggers/main.tf:27-43` — single-purpose Lambda IAM role idiom; the closest shape match for the anchor Lambda's role.
- `terraform/examples/greenfield/main.tf:17-23` — provider pin: `terraform >= 1.5`, `hashicorp/aws ~> 5.0`. Module's `required_providers` should match.

### Institutional Learnings

- `feedback_ship_inert_pattern` — multi-PR plans land new modules with tests but no live wiring; integration waits for the plan's own dependency gate. U7 follows this: bucket + IAM role + variable plumbing live; no Lambda assumes the role until U8a.
- `project_tfvars_secrets_hygiene` — terraform.tfvars holds plaintext secrets; the new variables are non-secret (mode, retention_days, KMS ARN already flowing via outputs). Don't introduce any tfvars secret.
- `feedback_lambda_zip_build_entry_required` — adding a Lambda is a two-place change (Terraform `handlers.tf` + `scripts/build-lambdas.sh`). U7 does NOT add a Lambda; U8a will. Inert variables alone don't trigger this rule.
- `feedback_handrolled_migrations_apply_to_dev` — applies to SQL migrations; U7 has zero DB schema impact.
- `project_v1_agent_architecture_progress` — broader pattern: ship narrow PRs that pass CI green and let dev-deploy be the integration test.

### External References

- AWS [Locking objects with S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-overview.html) — modes, permission list, deletion semantics.
- AWS [Configuring S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html) — one-way enablement; versioning constraint; "after enabling, you can't disable Object Lock or suspend versioning."
- AWS [SSE-KMS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html) — `kms:GenerateDataKey` + `kms:Decrypt` are required; `kms:Encrypt` is **not**.
- HashiCorp registry — [`aws_s3_bucket`](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket) (`object_lock_enabled` forces new resource), [`aws_s3_bucket_object_lock_configuration`](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_object_lock_configuration) (current shape; deprecated `token` argument).
- HashiCorp [v4.0 S3 refactor blog](https://www.hashicorp.com/en/blog/terraform-aws-provider-4-0-refactors-s3-bucket-resource) — the inline `object_lock_configuration` block on `aws_s3_bucket` is deprecated; use the standalone resource (Terraform won't drift-detect the inline form). Standalone resource is supported on AWS provider 4.x and 5.x — the repo's pin (`~> 5.0`, locked to 5.100.0) is well within range.
- AWS [Cohasset Associates Compliance Assessment](https://d1.awsstatic.com/r2018/b/S3-Object-Lock/Amazon-S3-Compliance-Assessment.pdf) — SEC 17a-4 / FINRA / CFTC posture for S3 Object Lock + COMPLIANCE-mode framing.

---

## Key Technical Decisions

1. **Module location: `terraform/modules/data/compliance-audit-bucket/`** — master plan U7 line 509 specifies this path. Provisions a bucket named `thinkwork-${var.stage}-compliance-anchors` (master plan line 513). The module-name vs bucket-name asymmetry mirrors the master plan's intent (the *module* spans audit-evidence concerns; the *bucket* is one of multiple audit artifacts the module may host in the future). Document in the module README.

2. **Object Lock configuration uses the standalone resource, not the deprecated inline block.** `aws_s3_bucket.object_lock_enabled = true` (forces new) at bucket create time, paired with a separate `aws_s3_bucket_object_lock_configuration` resource carrying the default-retention rule. Provider drift detection only works on the standalone resource form. AWS provider `~> 5.0` (locked to 5.100.0 in `terraform/examples/greenfield/.terraform.lock.hcl`) supports this shape.

3. **GOVERNANCE mode default with `mode` variable.** Module `var.mode` defaults to `"GOVERNANCE"`; valid values are `"GOVERNANCE"` and `"COMPLIANCE"`. Master plan Decision #2 — Compliance mode is irreversible (even AWS root cannot delete or shorten); shipping it on day one bricks dev iteration. Audit-engagement-time tfvars flip is the deferred follow-up. Composite-root variable `compliance_anchor_object_lock_mode` makes the flip a tfvars change rather than a code change (master plan line 513 — "switch-flip in tfvars at audit time").

4. **Retention default 365 days, parameterized.** Module `var.retention_days = 365`; `var.retention_years` not exposed (mutually exclusive with days; days is more flexible). SOC2 Type 1 baseline is 12 months; SEC 17a-4 7-year is explicitly out of scope per master plan.

5. **`force_destroy = false`, hardcoded.** Documented in the module README. Object Lock + `force_destroy` interact pathologically: in COMPLIANCE mode `terraform destroy` fails until retention expires regardless; in GOVERNANCE mode `force_destroy = true` would only succeed if the deploying principal has `s3:BypassGovernanceRetention` (which we explicitly don't grant). Either way, `force_destroy = true` masks retention behavior. Don't ship it.

6. **IAM role co-located with the bucket module.** Master plan U7 file list (line 509) places the role alongside the bucket. The role is purpose-specific to the anchor Lambda (no generic reuse); co-location keeps the resource graph contained in one module. U8a only needs to wire the Lambda function + EventBridge schedule, not the role.

7. **Explicit Deny for `s3:BypassGovernanceRetention` and `s3:PutObjectLegalHold` on the role's inline policy.** Master plan line 517 specifies *explicit* deny, not "absent from allow." The distinction matters: an absent allow can be overridden by a future broadening of the role's grants (e.g., a permissions-boundary change, an organization SCP, an AWS-managed-policy attachment), whereas an explicit deny survives all of those. SOC2 Type 1 representation is "WORM-immutable"; explicit deny makes that representation robust.

8. **Bucket policy with `aws:SecureTransport` Deny + `s3:DeleteObject`/`s3:DeleteObjectVersion` Deny from any principal.** Master plan line 518 + the `s3-backups-bucket` precedent. Defense-in-depth: even if a future role were to acquire `s3:DeleteObject*` actions, the bucket-level Deny short-circuits the delete. The Allow path on the anchor Lambda role does not include any Delete action, so this policy is invisible on the legitimate write path.

9. **`anchors/` + `proofs/` prefix architecture.** Master plan line 517 IAM scope is `${bucket}/anchors/*`; line 519 reserves `proofs/` for per-tenant slice bundles (U8b writes per-tenant proof slices here; slices are derivable from the chain + anchor and are *not* regulator-grade WORM, so U8b will set a shorter per-object retention). U7 declares both prefixes in IAM scope and lifecycle filter; U8b owns the actual writes. Lifecycle transitions only the `anchors/` prefix (the WORM stuff that will live for years); `proofs/` is transient enough to skip the rule.

10. **`bucket_key_enabled = true` for SSE-KMS.** Cuts KMS request volume by up to 99% with no Object Lock incompatibility. Encryption-context becomes the bucket ARN (not the object ARN); flag this in the module README in case a future per-object encryption-context policy lands.

11. **Lifecycle: `anchors/` Standard → Glacier IR at 90 days, no expiration.** Object Lock retention does the deletion gating. Glacier IR is the cost-effective tier with read latency suitable for verifier-CLI access; Glacier Flexible / Deep Archive add retrieval delay that hurts on-demand verification. 90-day floor is also the Glacier IR billing minimum — picking a smaller transition day would silently incur full-90-day storage charges anyway. Noncurrent versions transition to Glacier IR at 90 days as well — defense for a hypothetical future overwrite event.

12. **Tags: `Name` / `Stage` / `Purpose = "compliance-anchors"` / `Retention = "${var.retention_days}d"`.** PascalCase keys, no colons, matching the existing `data/s3-backups-bucket` `Purpose` pattern. The `Retention` tag is interpolated from the variable so it stays in sync if a future tfvars change widens retention. IAM roles do **not** get tag blocks — there is no role-tagging convention in the repo and adding one in this PR is out of scope.

13. **Output naming: submodule emits `bucket_arn` / `bucket_name` / `lambda_role_arn`; composite root re-exports as `compliance_anchor_bucket_arn` / `compliance_anchor_bucket_name` / `compliance_anchor_lambda_role_arn`.** Mirrors the backups-bucket flow exactly.

14. **Lambda-api tier receives the three values as inert variables with `default = ""`.** No `count` gate or resource references in U7 — the variables exist but are unused until U8a. Each variable carries a `Default empty until U8a wires the anchor Lambda` comment for grep-ability. Distinct from existing `agentcore_function_arn` (which IS gated on emptiness via `count`); U7 is purely shape reservation. Trade-off: U7 stays a clean infra-only PR; U8a's diff focuses on Lambda body + schedule wiring without also dragging variable declarations across module boundaries.

15. **Variable validation + Terraform `precondition` for typo-defense.** Master plan line 520 specifies a `precondition` validating retention. U7 implements it as both: (a) variable-level `validation { condition = var.retention_days > 0 }` rejects bad values at plan time; (b) `lifecycle.precondition { condition = var.kms_key_arn != "" }` on the SSE configuration resource prevents apply when the KMS chain breaks (e.g., if `module.kms.key_arn` is empty because `var.create_kms_key = false` somewhere upstream).

16. **Module README is plan-mandated.** Existing data submodules don't have READMEs as a convention, but the master plan requires one for U7 specifically. Sections: bucket purpose, Object Lock posture (GOVERNANCE→COMPLIANCE flip playbook), `anchors/`/`proofs/` prefix contract, KMS dependency, the `force_destroy` non-negotiable, the dev-cleanup playbook (operator commands for bypassing GOVERNANCE retention to clear a dev bucket).

---

## Open Questions

### Resolved During Planning

- *Module location* — `terraform/modules/data/compliance-audit-bucket/` per master plan U7 line 509. Bucket name `thinkwork-${stage}-compliance-anchors` per line 513. Asymmetry preserved.
- *Object Lock mode default* — GOVERNANCE for all stages; COMPLIANCE flip is a deferred prod-only PR.
- *KMS strategy* — Reuse existing `module.kms.key_arn`. U7 will be the first consumer; explicit deferral of master-plan-specified separate alias is documented in Scope Boundaries.
- *Server access logging* — Deferred per Scope Boundaries; CloudTrail covers SOC2 Type 1 question.
- *IAM role placement* — Co-located in `data/compliance-audit-bucket/`, not deferred to U8a (master plan U7 file list).
- *IAM scope* — Path-scoped to `${bucket_arn}/anchors/*` and `${bucket_arn}/proofs/*` (master plan line 517).
- *Explicit deny statements* — Yes, on the role's inline policy (master plan line 517). Plus bucket-policy DeleteObject deny (line 518).
- *Lifecycle floor* — 90 days to Glacier IR for `anchors/` prefix only. Sub-90 transitions still bill 90 days; Deep Archive deferred (verifier read latency cost).
- *`force_destroy` policy* — Always `false`. Object Lock + force_destroy is incompatible by design.
- *Bucket-name plural* — `thinkwork-${stage}-compliance-anchors` (plural). Master plan line 513.
- *Provider version* — `hashicorp/aws ~> 5.0` (locked to 5.100.0 per `terraform/examples/greenfield/.terraform.lock.hcl`).
- *Bucket policy added* — yes, with HTTPS-only + DeleteObject-deny statements.

### Deferred to Implementation

- Exact CloudWatch metric name for "anchor object writes" — U8b wires the metric; not in U7.
- Whether the read-side IAM role for the verifier CLI lives in U7 or U9. Defer to U9 — the verifier may run under a separate auditor-supplied account, in which case role placement is a different conversation.
- Per-object retention override semantics for the `proofs/` prefix — U8b owns this. U7 ships the prefix in IAM scope and bucket policy; the per-object Override-via-`s3:PutObjectRetention` to a shorter retention is a U8b concern (and may require adding a `s3:object-lock-remaining-retention-days` minimum-guard to the bucket policy).

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
terraform/modules/data/compliance-audit-bucket/
├── main.tf                         # bucket + lock + versioning + SSE-KMS + BPA + lifecycle + bucket-policy + IAM role + role policies
├── variables.tf                    # stage, bucket_name, kms_key_arn, mode, retention_days
├── outputs.tf                      # bucket_arn, bucket_name, lambda_role_arn
└── README.md                       # Object Lock posture + COMPLIANCE-mode cutover + force_destroy caveat + dev-cleanup playbook + prefix contract

                ┌──────────────────────────────────┐
                │ data/compliance-audit-bucket/    │
                │                                  │
                │  aws_s3_bucket.anchor            │
                │   .object_lock_enabled = true    │
                │  + lock_configuration            │
                │  + versioning(Enabled)           │
                │  + sse_kms (precondition)        │
                │  + public_access_block           │
                │  + lifecycle(anchors/ → IR @90d) │
                │  + bucket_policy (TLS + Deny     │
                │      s3:DeleteObject*)           │
                │  + iam_role + 2 inline policies  │
                │      (allow anchors/*+proofs/*,  │
                │       deny BypassGovRet+         │
                │       PutObjectLegalHold)        │
                └────────┬─────────────────────────┘
                         │ outputs:
                         │   bucket_arn
                         │   bucket_name
                         │   lambda_role_arn
                         ▼
                ┌─────────────────────────┐
                │ thinkwork/main.tf       │
                │   module "compliance_   │
                │     anchors"            │
                │ thinkwork/outputs.tf    │
                │   compliance_anchor_*   │
                └────────┬────────────────┘
                         │ vars (inert, default = "")
                         ▼
                ┌─────────────────────────┐
                │ app/lambda-api/         │
                │   variables.tf          │
                │   var.compliance_anchor_│
                │     bucket_arn          │
                │     bucket_name         │
                │     lambda_role_arn     │
                │  (declared, unused)     │
                └─────────────────────────┘
```

---

## Implementation Units

- U1. **Create `terraform/modules/data/compliance-audit-bucket/` module — bucket + Object Lock + KMS + lifecycle + bucket policy**

**Goal:** Land the WORM-protected S3 bucket with all companion resources (versioning, SSE-KMS, public access block, lifecycle, bucket policy), parameterized for mode/retention/KMS key, plus module variables and module-level outputs for `bucket_arn` and `bucket_name`. No IAM role yet (U2). R6 is partially satisfied here — `lambda_role_arn` lands in U2.

**Requirements:** R1, R2, R3, R4, R6 (partial), R8, R9, R10, R11

**Dependencies:** None (greenfield module)

**Files:**
- Create: `terraform/modules/data/compliance-audit-bucket/main.tf`
- Create: `terraform/modules/data/compliance-audit-bucket/variables.tf`
- Create: `terraform/modules/data/compliance-audit-bucket/outputs.tf`
- Create: `terraform/modules/data/compliance-audit-bucket/README.md`

**Approach:**
- `aws_s3_bucket.anchor` with `bucket = var.bucket_name`, `object_lock_enabled = true`, `force_destroy = false`. Tags: `Name = var.bucket_name`, `Stage = var.stage`, `Purpose = "compliance-anchors"`, `Retention = "${var.retention_days}d"`.
- `aws_s3_bucket_versioning.anchor` with `versioning_configuration { status = "Enabled" }`.
- `aws_s3_bucket_object_lock_configuration.anchor` with `rule.default_retention { mode = var.mode, days = var.retention_days }`. `depends_on = [aws_s3_bucket_versioning.anchor]` because AWS rejects Object Lock configuration before versioning is `Enabled`; the explicit dependency prevents Terraform from applying them in parallel and getting a 400 from S3.
- `aws_s3_bucket_server_side_encryption_configuration.anchor` with `sse_algorithm = "aws:kms"`, `kms_master_key_id = var.kms_key_arn`, `bucket_key_enabled = true`. Carries a `lifecycle.precondition { condition = var.kms_key_arn != "" && var.kms_key_arn != null, error_message = "kms_key_arn must be non-empty — check that module.kms is enabled in the composite root." }` so a misconfigured upstream fails at plan time, not apply time.
- `aws_s3_bucket_public_access_block.anchor` with all four flags `true`.
- `aws_s3_bucket_lifecycle_configuration.anchor`: one rule, `id = "anchor-glacier-ir"`, `status = "Enabled"`, `filter { prefix = "anchors/" }`, transition to `GLACIER_IR` at 90 days, `noncurrent_version_transition { noncurrent_days = 90, storage_class = "GLACIER_IR" }`. **No** expiration rule.
- `aws_s3_bucket_policy.anchor` (with `depends_on = [aws_s3_bucket_public_access_block.anchor]`) carrying two Deny statements:
  - `Sid = "EnforceHTTPS"`, `Effect = "Deny"`, `Principal = "*"`, `Action = "s3:*"`, `Resource = [bucket_arn, bucket_arn/*]`, `Condition = { Bool = { "aws:SecureTransport" = "false" } }`. Mirrors `terraform/modules/data/s3-backups-bucket/main.tf:85-113`.
  - `Sid = "DenyDeleteObject"`, `Effect = "Deny"`, `Principal = "*"`, `Action = ["s3:DeleteObject", "s3:DeleteObjectVersion"]`, `Resource = "${bucket_arn}/*"`. Master plan line 518.
- Module variables (with validation):
  - `stage` (string, required).
  - `bucket_name` (string, required).
  - `kms_key_arn` (string, required, validation: `length(var.kms_key_arn) > 0`).
  - `mode` (string, default `"GOVERNANCE"`, validation: `contains(["GOVERNANCE", "COMPLIANCE"], var.mode)`).
  - `retention_days` (number, default `365`, validation: `var.retention_days > 0`).
- Module outputs (this unit): `bucket_arn`, `bucket_name`. (`lambda_role_arn` lands in U2 — explicitly noted in U1's outputs.tf as "additional outputs added by U2 — see role definition in main.tf".)
- README sections (succinct, ~60-80 lines total):
  1. **What this is** — anchor bucket purpose, prefix contract (`anchors/` = WORM, `proofs/` = transient slices).
  2. **Object Lock posture** — GOVERNANCE default, the COMPLIANCE-mode cutover playbook (one-line tfvars change; verify post-flip; document the "irreversible-by-AWS-root" property).
  3. **`force_destroy = false` invariant** — why it's hardcoded, the dev-cleanup playbook (admin role with `s3:BypassGovernanceRetention` runs `aws s3 rm --bypass-governance-retention --recursive` then `aws s3 rb`; mention the S3 bucket-name reuse latency).
  4. **KMS dependency** — first consumer of the thinkwork CMK; risk if the key policy is later tightened without naming the anchor role; the precondition that catches misconfigured `kms_key_arn` early.
  5. **Provider pin** — repo-wide `hashicorp/aws ~> 5.0`.

**Patterns to follow:**
- `terraform/modules/data/s3-backups-bucket/main.tf` for module shape, tag block, `depends_on` discipline, and the bucket-policy idiom.
- `terraform/modules/data/s3-buckets/main.tf:38-44` for the `aws_s3_bucket_versioning` idiom.
- HashiCorp registry recommended shape for `aws_s3_bucket_object_lock_configuration` + the standalone-resource pattern (not the deprecated inline block).
- `terraform/modules/app/lambda-api/variables.tf:223-226` (`computer_runtime_assign_public_ip`) for variable `validation` block syntax.

**Test scenarios:**
- Happy path: `terraform validate` from `terraform/examples/greenfield/` after the module is wired in U3 shows no errors.
- Edge case: `var.mode = "INVALID"` — variable validation rejects with a clear error message before the submodule is reached.
- Edge case: `var.retention_days = 0` — variable validation rejects.
- Edge case: `var.kms_key_arn = ""` — variable validation rejects (and the resource-level `lifecycle.precondition` is a second line of defense).
- Edge case: `var.retention_days = 365 * 100` — accepted (no upper bound; GOVERNANCE mode allows arbitrary long retention).
- Integration: after `terraform apply`, `aws s3api get-object-lock-configuration --bucket thinkwork-dev-compliance-anchors` returns `ObjectLockEnabled: Enabled`, `Rule.DefaultRetention.Mode: GOVERNANCE`, `Rule.DefaultRetention.Days: 365`.
- Integration: `aws s3api get-bucket-versioning --bucket thinkwork-dev-compliance-anchors` returns `Status: Enabled`.
- Integration: `aws s3api get-public-access-block --bucket thinkwork-dev-compliance-anchors` returns all four flags `true`.
- Integration: `aws s3api get-bucket-encryption --bucket thinkwork-dev-compliance-anchors` returns SSE-KMS with the thinkwork CMK ARN and `BucketKeyEnabled: true`.
- Integration: `aws s3api get-bucket-lifecycle-configuration --bucket thinkwork-dev-compliance-anchors` returns one rule scoped to `anchors/` transitioning current versions to `GLACIER_IR` at 90 days and noncurrent versions at 90 days, no expiration.
- Integration: `aws s3api get-bucket-policy --bucket thinkwork-dev-compliance-anchors` returns the EnforceHTTPS + DenyDeleteObject statements (parse JSON; assert both Sids present).
- Integration: HTTP-attempt smoke — issue a `curl http://...` (plain HTTP) PUT against the bucket; expect 403 Forbidden.
- Drift: `terraform plan` after `terraform apply` shows zero diff (the standalone Object Lock configuration resource handles drift correctly; the deprecated inline block does not).

**Verification:**
- `terraform init` + `terraform validate` succeed on the module directory in isolation (`terraform init -backend=false`).
- `terraform plan` against the dev stage shows the new bucket and seven companion resources (lock config, versioning, SSE, BPA, lifecycle, bucket policy, plus tags), with no diff to existing buckets.
- README explains the COMPLIANCE-mode flip, the `force_destroy = false` rationale, the prefix contract, the KMS dependency, and the dev-cleanup playbook.

---

- U2. **Add IAM role + inline policies (Allow + Deny) for the future anchor Lambda**

**Goal:** Ship the IAM role that U8a's anchor Lambda will assume. Inline policies grant exactly the actions the Lambda will need at U8b — narrowest scope — and explicitly Deny `s3:BypassGovernanceRetention` and `s3:PutObjectLegalHold` so the deny survives any future broadening of the role. Module exports the role ARN as a third output.

**Requirements:** R5, R6 (completes), R7

**Dependencies:** U1 (bucket must exist for inline-policy interpolation of `aws_s3_bucket.anchor.arn`)

**Files:**
- Modify: `terraform/modules/data/compliance-audit-bucket/main.tf` (add role + 3 inline policies + basic-execution attachment)
- Modify: `terraform/modules/data/compliance-audit-bucket/outputs.tf` (add `lambda_role_arn`)
- Modify: `terraform/modules/data/compliance-audit-bucket/README.md` (document the role's scope, the explicit-deny rationale, and the no-`s3:BypassGovernanceRetention` invariant)

**Approach:**
- `aws_iam_role.anchor_lambda` with `name = "thinkwork-${var.stage}-compliance-anchor-lambda-role"`, `assume_role_policy = jsonencode({...lambda.amazonaws.com trust})`. No tags (matches repo convention for IAM roles).
- `aws_iam_role_policy_attachment.anchor_basic` attaching `arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole` (CloudWatch Logs).
- `aws_iam_role_policy.anchor_s3_allow` with three statements:
  - Statement A (Allow object-side): `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:GetObjectRetention` on `["${aws_s3_bucket.anchor.arn}/anchors/*", "${aws_s3_bucket.anchor.arn}/proofs/*"]`.
  - Statement B (Allow bucket-side): `s3:GetBucketObjectLockConfiguration` on `${aws_s3_bucket.anchor.arn}`.
  - Statement C (Explicit Deny): `s3:BypassGovernanceRetention`, `s3:PutObjectLegalHold` on `${aws_s3_bucket.anchor.arn}/*`. Master plan line 517 — explicit deny survives broader-scope grants from a future PR.
- `aws_iam_role_policy.anchor_kms` granting `kms:GenerateDataKey`, `kms:Decrypt`, `kms:DescribeKey` on `var.kms_key_arn`. Do **not** include `kms:Encrypt` — SSE-KMS uses `GenerateDataKey`, not `Encrypt`.
- Output: `lambda_role_arn = aws_iam_role.anchor_lambda.arn`.

**Patterns to follow:**
- `terraform/modules/app/sandbox-log-scrubber/main.tf:89-100` for trust + inline-policy idiom.
- `terraform/modules/app/lambda-api/main.tf:206-226` for S3 inline-policy resource scoping.
- AWS S3 Service Authorization Reference for the resource-type ARN split (object vs bucket).

**Test scenarios:**
- Happy path: `terraform validate` passes after U2 changes.
- Static review: confirm one Deny statement explicitly enumerating `s3:BypassGovernanceRetention` and `s3:PutObjectLegalHold` exists in the rendered policy JSON. Confirm the Allow statements scope object-side actions to `anchors/*` and `proofs/*` — never bare `*`. Confirm no `kms:Encrypt`.
- Static review: confirm the S3 Allow's resource-scope split is `${bucket_arn}/anchors/*` + `${bucket_arn}/proofs/*` (object-side) and `${bucket_arn}` (bucket-side), not a single mixed scope.
- Integration: after deploy, `aws iam get-role --role-name thinkwork-dev-compliance-anchor-lambda-role` returns the role; `aws iam list-role-policies --role-name <role>` shows `anchor_s3_allow` and `anchor_kms`; `aws iam get-role-policy` shows the expected statements.
- Integration: the role exists but is unassumed (no Lambda function uses it yet) — verify with `aws cloudtrail lookup-events --lookup-attributes AttributeKey=ResourceName,AttributeValue=thinkwork-dev-compliance-anchor-lambda-role` showing only the create event.

**Verification:**
- IAM role + 2 inline policies (`anchor_s3_allow` and `anchor_kms`) + basic-execution attachment exist post-deploy.
- The rendered S3 policy contains 3 statements (Allow object-side, Allow bucket-side, Deny) with the exact action sets above.
- The rendered KMS policy contains exactly 3 actions (no `kms:Encrypt`).
- Module outputs all three values: `bucket_arn`, `bucket_name`, `lambda_role_arn`.

---

- U3. **Wire data → thinkwork → app/lambda-api: instantiate module, re-export outputs, declare inert app variables**

**Goal:** Plumb the new module into the composite root and forward its outputs as inert variables into `app/lambda-api`. After this unit, the bucket and IAM role exist in dev, and `lambda-api` has variable shape ready for U8a.

**Requirements:** R6, R7, R10

**Dependencies:** U2

**Files:**
- Modify: `terraform/modules/thinkwork/main.tf` (add `local.compliance_anchor_bucket_name`; instantiate `module "compliance_anchors"`; pass outputs into `module "lambda_api"`)
- Modify: `terraform/modules/thinkwork/outputs.tf` (add `compliance_anchor_bucket_arn`, `compliance_anchor_bucket_name`, `compliance_anchor_lambda_role_arn`)
- Modify: `terraform/modules/thinkwork/variables.tf` (add `compliance_anchor_object_lock_mode`, `compliance_anchor_retention_days` with master-plan defaults)
- Modify: `terraform/modules/app/lambda-api/variables.tf` (declare 3 inert variables with `default = ""`)
- Optional: `terraform/examples/greenfield/terraform.tfvars.example` — add commented placeholders for the two new tfvars so future greenfield deploys see them.

**Approach:**
- Composite root local: `local.compliance_anchor_bucket_name = "thinkwork-${var.stage}-compliance-anchors"` co-located with the existing `local.backups_bucket_name`.
- Module instantiation passes `stage`, `bucket_name = local.compliance_anchor_bucket_name`, `kms_key_arn = module.kms.key_arn`, `mode = var.compliance_anchor_object_lock_mode`, `retention_days = var.compliance_anchor_retention_days`.
- Composite-root variables: `compliance_anchor_object_lock_mode` defaults to `"GOVERNANCE"` (validation: GOVERNANCE or COMPLIANCE); `compliance_anchor_retention_days` defaults to `365`.
- Composite-root outputs: three new outputs mirroring the backups-bucket re-export pattern.
- Forward into `module "lambda_api"`: pass `compliance_anchor_bucket_arn = module.compliance_anchors.bucket_arn`, `compliance_anchor_bucket_name = module.compliance_anchors.bucket_name`, `compliance_anchor_lambda_role_arn = module.compliance_anchors.lambda_role_arn`. (Even though they're inert in U7's lambda-api, the wiring is what proves the shape works.)
- `lambda-api/variables.tf` declares all three with `default = ""` and the comment `# Default empty until U8a wires the anchor Lambda.`

**Patterns to follow:**
- `terraform/modules/thinkwork/main.tf:14, 116-121, 147-148` — backups-bucket three-tier wiring (composite local → module instantiation → forward into downstream consumer).
- `terraform/modules/app/lambda-api/variables.tf:183-193, 411-415` — inert-variable convention with `default = ""` and explanatory comment.

**Test scenarios:**
- Happy path: `terraform plan` from `terraform/examples/greenfield/` against the dev stage shows the new bucket + 8 companion resources (lock config, versioning, SSE, BPA, lifecycle, bucket policy, IAM role, 2 inline role policies, basic-execution attachment) and zero diff on existing resources.
- Edge case: `var.compliance_anchor_object_lock_mode = "INVALID"` — composite-root variable validation rejects with a clear error message before the submodule is reached.
- Edge case: omitting both new tfvars — defaults take over (GOVERNANCE, 365 days).
- Static review: lambda-api has exactly three new variables, all `default = ""`, none referenced by any resource.
- Drift: a second `terraform plan` after `terraform apply` shows zero diff, including for the lambda-api variables (which never become `count` arguments).

**Verification:**
- `terraform plan` runs cleanly against `dev` and shows only the expected new resources.
- After `terraform apply`, all R10 verification commands pass (Object Lock, versioning, BPA, encryption, lifecycle, bucket policy, IAM).
- A subsequent `terraform plan` shows zero diff.
- Greenfield `terraform.tfvars.example` (if updated) passes `terraform fmt -check` and stays compatible with the existing greenfield example flow.

---

## System-Wide Impact

- **Interaction graph:** None in U7 — bucket + role are inert (no Lambda assumes the role; no caller writes to the bucket). U8a wires the EventBridge schedule + Lambda; U8b wires the live PutObject + retention.
- **Error propagation:** N/A for U7 (no app code path).
- **State lifecycle risks:** None during U7. The two cross-cutting risks live at U8b: (1) per-object retention writes require `Content-MD5` or `x-amz-sdk-checksum-algorithm` (AWS SDK v3 includes a checksum by default; if a future low-level fetch path lands, retention writes 400); (2) Object Lock is one-way — once enabled at create time, it cannot be disabled. Both are explicit in the module README.
- **API surface parity:** None. No GraphQL, no resolvers, no Lambda handlers. Three new Terraform variables in `lambda-api`, all unreferenced.
- **Integration coverage:** Verified by `terraform plan`/`apply` + post-deploy AWS-CLI smoke (R10). No application-tier integration in U7.
- **Unchanged invariants:** `module.kms.aws_kms_key.main` key policy is unchanged (we rely on the existing same-account root statement). Existing buckets (`s3-buckets/main.tf`, `s3-backups-bucket/main.tf`, `routine_output`, `wiki_exports`, static-site buckets) are unchanged. Existing `lambda-api` Lambda functions are unchanged — the three new variables are declared but never referenced. The drift gate (currently disabled per #905) is irrelevant: U7 has no SQL migrations.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Object Lock is one-way at the AWS level — recreating the bucket later (e.g., to flip `object_lock_enabled`) is destructive, since `force_destroy = false` and the bucket may hold WORM-protected anchors. | Set `object_lock_enabled = true` correctly in U7. Pin to the GOVERNANCE→COMPLIANCE-via-config-only path; never plan a bucket recreate. README spells this out. |
| Provider drift on the deprecated inline `object_lock_configuration` block on `aws_s3_bucket`. | Use only the standalone `aws_s3_bucket_object_lock_configuration` resource. `terraform plan` should show zero diff after first apply; if drift appears, the bug is in the implementation (likely the inline block accidentally set). |
| `force_destroy = true` would mask Object Lock retention behavior; `terraform destroy` in dev would either succeed silently (GOVERNANCE + bypass on the deploying principal — we don't grant it) or fail confusingly (COMPLIANCE — by design). | Hardcode `force_destroy = false`. Document in README + dev-cleanup playbook. Anyone needing to tear down dev does it via the documented playbook (admin role + `--bypass-governance-retention`). |
| KMS key policy is currently the default "root account" statement; if a future PR tightens it without including the anchor Lambda role, anchor writes fail at runtime. | Out of U7's scope, but the README flags this dependency. The SSE config carries a `lifecycle.precondition` so misconfigured `kms_key_arn` fails at plan time. U8b smoke test will catch a runtime regression. |
| The 90-day Glacier IR transition is a billing minimum, not a hard floor — sub-90 transitions still bill 90 days. | Set the transition to exactly 90; document the AWS billing-floor rationale in the README so a future "let's transition at 30 days for cost savings" PR knows the math doesn't help. |
| Adding three unused variables to `lambda-api/variables.tf` is "dead code" until U8a — a reviewer may flag it as YAGNI. | Decision #14 explicitly notes the trade-off. Comment in the variables file ties them to U8a. |
| `lambda-api` module has many existing variables; threading three more through `module "lambda_api"` instantiation in `thinkwork/main.tf` is a small noise-floor change but easy to typo. | Mechanical pass-through. `terraform validate` catches missing/extra arguments before plan. |
| `module.kms.aws_kms_key.main` is `count`-gated. If the dev stage was ever deployed with `create_kms_key = false`, the anchor module's `kms_key_arn` input would be empty and the SSE config would fail. | Variable-level validation + resource-level `lifecycle.precondition` catch this at plan time, not apply time. |
| The GOVERNANCE→COMPLIANCE prod cutover is operator-memory dependent (no Terraform-time guardrail). | README documents the cutover playbook explicitly. The composite-root variable makes the flip a one-line tfvars change. A follow-up PR may add a stage-gated precondition (e.g., `var.stage == "prod"` requires `var.compliance_anchor_object_lock_mode == "COMPLIANCE"`) once the prod stack lands; deferring that to U7 today would block the dev iteration story. |
| `proofs/` prefix is included in IAM scope but no Object Lock per-object-retention override is wired in U7 — U8b owns that. If U8b ships before the bucket-policy `s3:object-lock-remaining-retention-days` minimum guard, a buggy U8b could write a 1-day-retention proof and still succeed. | Out of U7's scope — flagged in U8b's plan / smoke test. The bucket-level Lock default still applies absent an override. |

---

## Documentation / Operational Notes

- README at `terraform/modules/data/compliance-audit-bucket/README.md` documents: bucket purpose, GOVERNANCE-vs-COMPLIANCE posture, the `force_destroy = false` invariant, the KMS dependency, the prod-cutover playbook, the dev-cleanup playbook (operator commands for clearing a dev bucket via admin-role bypass), the prefix contract (`anchors/` Lock-protected, `proofs/` reserved for U8b transient slices), and provider-version pin.
- Update `terraform/examples/greenfield/terraform.tfvars.example` (if present) with commented placeholders for the two new tfvars so a fresh deployer sees them. Keep them commented — the defaults are correct for greenfield-dev.
- Master plan U7 verification commands (R10) become the smoke set after deploy. Consider adding a post-deploy smoke script (`scripts/smoke-compliance-anchor-bucket.sh`) in a follow-up PR so verification is automated rather than operator-laptop-only.
- No CloudWatch alarms in U7. The watchdog Lambda + alarm land in U8a (master plan Decision #9).
- After the dev deploy passes, the U7 PR should note in its description: "U8a will wire the anchor Lambda to assume `compliance_anchor_lambda_role_arn` and write to `compliance_anchor_bucket_name` under the `anchors/` prefix; U8b will wire `proofs/` writes."

---

## Sources & References

- **Master plan:** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` (U7 entry lines 500-532; Decision #2 — GOVERNANCE/COMPLIANCE; Decision #9 — inert→live seam swap).
- **Brainstorm:** `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md` (Phase 3 origin).
- **Memory (active):** `project_system_workflows_revert_compliance_reframe`, `feedback_ship_inert_pattern`, `project_tfvars_secrets_hygiene`.
- **Recently merged compliance work:** PR #890 (U3), #903 (U5), #911 (U6).
- **Related code:**
  - `terraform/modules/data/s3-backups-bucket/main.tf` — closest module analog (incl. EnforceHTTPS bucket-policy idiom at lines 85-113).
  - `terraform/modules/foundation/kms/main.tf:25-49` — canonical CMK source.
  - `terraform/modules/thinkwork/main.tf:14, 116-121, 147-148` — three-tier pass-through example.
  - `terraform/modules/app/lambda-api/variables.tf:183-193, 223-226` — inert-variable convention + variable validation idiom.
  - `terraform/modules/app/sandbox-log-scrubber/main.tf:89-100` — single-purpose Lambda IAM role idiom.
  - `terraform/examples/greenfield/main.tf:17-23` — provider pin (`hashicorp/aws ~> 5.0`).
- **External docs:**
  - AWS S3 Object Lock — https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-overview.html
  - AWS Configuring S3 Object Lock — https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html
  - AWS SSE-KMS — https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html
  - HashiCorp `aws_s3_bucket` — https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket
  - HashiCorp `aws_s3_bucket_object_lock_configuration` — https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket_object_lock_configuration
  - HashiCorp v4.0 S3 refactor blog — https://www.hashicorp.com/en/blog/terraform-aws-provider-4-0-refactors-s3-bucket-resource
  - Cohasset Associates Compliance Assessment (PDF) — https://d1.awsstatic.com/r2018/b/S3-Object-Lock/Amazon-S3-Compliance-Assessment.pdf
