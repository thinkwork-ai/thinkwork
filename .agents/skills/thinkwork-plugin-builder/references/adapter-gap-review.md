# Adapter Gap Review

Use this reference for any plugin with an infrastructure component.

## Source of Truth

Current managed-app adapter support is defined by:

- `packages/deployment-runner/src/apps/registry.ts`
- `packages/api/src/lib/plugins/handlers/infra.ts`

At the time this skill was written, supported adapter keys are:

- `cognee`
- `plane`
- `twenty`

Treat that set as closed unless the target repo has changed. If the source
Terraform needs another deployment shape, stop before manifest finalization.

## Fit Check

Compare the Terraform inventory to existing adapters:

- required input names and secret references,
- Terraform module path and resource lifecycle,
- data-impact disclosure,
- smoke contracts and status outputs,
- adoption/import expectations,
- destroy/park behavior,
- per-tenant endpoint outputs needed by MCP components.

An infrastructure component is acceptable only when the adapter can actually
provision or adopt the resources represented by the source project.

## Gap Review Template

```markdown
## Adapter Gap Review

### Source Project Summary

- Product:
- Terraform roots:
- Resource categories:
- Required inputs/secrets:
- Outputs/endpoints:
- Lifecycle risks:

### Current Adapter Comparison

| Adapter | Fit            | Evidence |
| ------- | -------------- | -------- |
| cognee  | no/partial/yes |          |
| plane   | no/partial/yes |          |
| twenty  | no/partial/yes |          |

### Decision

- [ ] Existing adapter fits.
- [ ] New managed-app adapter required.
- [ ] Smaller first plugin slice recommended.

### Follow-Up Platform Work

- `packages/deployment-runner/src/apps/<new-adapter>.ts`
- `packages/deployment-runner/src/apps/registry.ts`
- `terraform/modules/app/<new-adapter>/`
- `packages/api/src/lib/plugins/handlers/infra.ts` tests if handler behavior changes.
- `plugins/<plugin-key>/src/manifest.ts` after adapter support exists.

### Secret and Customer Data Review

- Raw tfvars excluded:
- Credentials excluded:
- Environment-specific values converted to input contracts:
```

## McPherson Lakehouse Signals

Expect McPherson-like projects to mention S3, Glue, Iceberg, Dagster, Athena,
IAM, scheduling, and observability. Those categories do not currently imply a
supported managed-app key. If no adapter fits, recommend adapter work or a
smaller first slice instead of writing `managedAppKey: "lakehouse"`.
