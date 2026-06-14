---
date: 2026-06-14
linear: THNK-26
subject: McPherson Lakehouse plugin-builder proof
---

# McPherson Lakehouse Plugin Builder Proof

## Source Availability

No McPherson Lakehouse Terraform source or sanitized export was present in this
worktree during THNK-26 implementation. A repo search for McPherson/Lakehouse
paths and references found only historical planning mentions unrelated to the
POC source. This proof therefore uses the skill's sanitized
McPherson-like Terraform fixture and records the real-source dependency instead
of claiming access to private customer files.

## Sanitized Fixture Inventory

Fixture path:
`.agents/skills/thinkwork-plugin-builder/tests/fixtures/minimal-terraform-project/`

- Terraform root: fixture directory.
- Providers: AWS.
- Backend/state: not declared in the fixture.
- Storage: S3 raw lakehouse bucket.
- Catalog/metadata: Glue catalog database.
- Orchestration: represented by a sensitive Dagster token input contract, not a
  copied secret.
- Query: Athena is not implemented in the fixture; it remains part of the
  McPherson-like checklist in the skill reference.
- IAM/network/observability: not implemented in the fixture; the intake
  reference requires explicit inventory for real source.
- Inputs:
  - `aws_region`: environment configuration.
  - `raw_bucket_name`: tenant/operator configuration.
  - `glue_database_name`: tenant/operator configuration.
  - `dagster_token_secret_arn`: secret reference contract.
- Outputs:
  - `raw_bucket_name`.
  - `glue_database_name`.

## Adapter Fit Evidence

The current deployment-runner registry exposes `cognee` and `twenty` managed-app
adapters. The lakehouse fixture does not fit either adapter shape: it models AWS
data-lake resources rather than Cognee or Twenty application runtime inputs.

The builder skill therefore must stop before finalizing an infrastructure
manifest with `managedAppKey: "lakehouse"`. Its scanner flags that key as
blocking unless an adapter-gap review is present, and downgrades it to a
maintainer warning when the gap review is attached.

## Secret and Customer Data Review

- Raw tfvars: excluded.
- Terraform state: excluded.
- Customer credentials: excluded.
- Account IDs and environment-specific customer values: excluded.
- Secrets are represented only as input contracts, such as a Secrets Manager ARN
  for the Dagster integration token.

## Maintainer Recommendation

Smaller first slice or new adapter work is required before a real McPherson
Lakehouse catalog plugin should be implemented.

The likely follow-up is a managed-app/deployment-runner adapter decision:

- If ThinkWork wants the full lakehouse as one managed application, add a
  dedicated adapter under `packages/deployment-runner/src/apps/`, register it in
  `packages/deployment-runner/src/apps/registry.ts`, add Terraform under
  `terraform/modules/app/`, and then author the plugin manifest.
- If the full scope is too broad, choose a smaller first plugin slice, such as
  catalog/metadata setup or monitoring-only surfaces, and preserve the remaining
  S3/Glue/Iceberg/Dagster/Athena evidence for follow-up planning.

This proof satisfies the THNK-26 safety requirement: the skill produces intake
and adapter-gap evidence without committing private customer source or emitting
an invalid infrastructure manifest.
