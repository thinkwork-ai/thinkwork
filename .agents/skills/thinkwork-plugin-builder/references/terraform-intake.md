# Terraform Intake

Complete this inventory before proposing plugin artifacts.

## Locate Roots

- Find directories containing `.tf` files.
- Identify root modules versus reusable child modules.
- Note wrapper scripts, Makefiles, CI workflows, READMEs, and deployment docs.
- Identify whether Terraform state is local, remote backend, or undocumented.

## Inventory Infrastructure

Record categories, not secrets:

- Providers and aliases.
- Backends, state workspaces, and state migration expectations.
- Modules and external module sources.
- Resources by service, especially:
  - S3 buckets, policies, lifecycle, replication, and data-retention settings.
  - Glue databases, crawlers, jobs, catalogs, and IAM.
  - Iceberg table/catalog assumptions.
  - Dagster runtime assumptions, images, schedules, sensors, and secrets.
  - Athena workgroups, databases, output locations, and permissions.
  - IAM roles, policies, trust relationships, and cross-account assumptions.
  - VPC, subnet, security group, endpoint, and DNS dependencies.
  - Observability, schedules, alarms, and operational runbooks.
- Variables and outputs, classifying each as:
  - product configuration,
  - environment-specific value,
  - secret reference,
  - generated output,
  - operator decision.
- Destructive lifecycle risks:
  - bucket/table deletion,
  - data retention,
  - replacement resources,
  - import/adoption needs,
  - migration/backfill assumptions.

## Secret Handling

Do not copy raw tfvars, state, credentials, account IDs, customer hostnames, or
environment-specific values into contribution files. Convert them to input
contracts such as "Secrets Manager ARN containing the lakehouse service token" or
"S3 bucket name chosen by the tenant operator."

If source files contain values that appear sensitive, record only:

- the variable/output/resource name,
- why it is sensitive,
- the required secret/input contract,
- where the platform should source it at install time.

## Intake Summary Template

```markdown
## Terraform Inventory

### Roots and Modules

- Root:
- Child modules:
- Wrapper scripts/docs:

### Providers and State

- Providers:
- Backend/state:
- Workspace/environment model:

### Resource Categories

- Storage:
- Catalog/metadata:
- Compute/orchestration:
- Query:
- IAM/security:
- Network:
- Observability/schedules:

### Inputs and Outputs

| Name | Direction | Classification | Notes |
| ---- | --------- | -------------- | ----- |

### Lifecycle Risks

- Destructive operations:
- Import/adoption needs:
- Data-retention assumptions:

### Open Decisions

- Customer-facing product name:
- Premium install-key copy:
- Publication target:
- Destructive lifecycle stance:
```
