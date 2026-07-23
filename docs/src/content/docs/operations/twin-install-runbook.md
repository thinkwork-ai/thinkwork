---
title: Digital Twin install runbook
description: "How an engineer installs or adopts the Digital Twin for a stage with `thinkwork twin install`: prereqs, flags, per-model deploy channels, and the report contract."
---

The Digital Twin is installed white-glove: an engineer runs one idempotent
command against a target stage. There is no plugin catalog entry, install
button, or operator self-serve path — MCP registration is the only
enablement switch.

```bash
thinkwork twin install -s <stage> [--tenant <slug>] \
  --etl-repo-dir ~/src/mcpherson-thinkwork [--dry-run]
```

## What it does

1. **Prereq checks** (doctor-style): AWS CLI + credentials for the target
   account, Terraform, a local etl repo checkout, tenant resolution. A
   failing check exits 1 before anything is touched.
2. **etl-repo stacks** — applies the etl repo's twin stacks for the
   account (`aurora → data-lake → landing → query-router → dagster →
neptune`) using its `accounts/<slug>.{backend.hcl,tfvars}` machinery.
   Existing per-account state makes this a no-op on standing
   infrastructure. Every apply is plan-gated: destructive plans
   (delete/replace) always abort; modification plans require
   `--allow-changes`; only clean creates apply unprompted.
3. **Product Neptune wiring** — carries the neptune stack outputs
   (`cluster_endpoint`, `cluster_resource_id`, `client_sg_id`) into the
   stage's variable channel, runs the standard deploy, and verifies
   `NEPTUNE_ENDPOINT` landed in `/thinkwork/<stage>/runtime-config`
   (the document strips empty values; a missing key means the deploy
   never carried the variables).
4. **MCP registration** — checks for an active `digital-twin` MCP server
   for the tenant and, only when absent (or `--rotate` is passed), calls
   the THINK-333 provisioning route (`POST
/api/tenants/{tenantId}/mcp-twin-provision`). Provisioning always
   rotates the `tkt_` key, which is why an existing registration is
   adopted rather than re-provisioned.

## Variable channels per deployment model

- **dev** — `deploy.yml` reads the three Neptune values from GitHub repo
  variables (`NEPTUNE_ENDPOINT`, `NEPTUNE_CLUSTER_RESOURCE_ID`,
  `NEPTUNE_CLIENT_SG_ID`, `NEPTUNE_LOAD_BUCKET`, `NEPTUNE_LOADER_ROLE_ARN`). The command sets them with `gh variable set`
  **before** dispatching the workflow (GitHub Actions variables snapshot
  at trigger) and watches the run.
- **customer stages** — the values live in the
  `/thinkwork/<stage>/deployment/runner-secrets` document as
  `neptuneEndpoint` / `neptuneClusterResourceId` /
  `neptuneClientSecurityGroupId` / `neptuneLoadBucket` / `neptuneLoaderRoleArn`; the control-plane runner's `vars_json`
  allowlist forwards them into Terraform. The command merges the keys
  into the document (touching nothing else) and starts a deployment
  controller `update` run, waiting for the result. The runner allowlist
  change shipped with this feature must be in the release the customer
  runs.

## Flags

| Flag              | Meaning                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `-s, --stage`     | Target stage.                                                                                                                 |
| `-t, --tenant`    | Tenant slug. Required when the stage has more than one tenant; inferred when there is exactly one. Never "first tenant wins". |
| `--etl-repo-dir`  | Local checkout of the etl repo (McPherson-Data/thinkwork). Falls back to `THINKWORK_ETL_REPO`.                                |
| `--etl-account`   | etl `accounts/<slug>` entry to use. Defaults: `dev` → `thinkwork`, otherwise the stage name.                                  |
| `--dry-run`       | Checks, Terraform plans, and channel diff only; no applies, deploys, or API writes.                                           |
| `--allow-changes` | Permit Terraform _modifications_ to already-existing stacks. Destructive plans still abort.                                   |
| `--rotate`        | Force MCP re-provisioning (rotates the `tkt_` key).                                                                           |

## Report and exit codes

The run ends with a per-resource table (`found` / `created` / `skipped` /
`FAILED`) plus any steps not attempted because an earlier step failed.
Exit 0 = complete (a fully-installed stage re-run reports zero changes);
exit 1 = failed or work remaining. Every step is idempotent — fix the
failure and re-run; the command resumes by re-detection, not checkpoints.

## What it never does

- Destroy or replace twin resources — removal is a deliberate manual
  action in the etl repo.
- Onboard a brand-new account into the etl repo: a missing
  `accounts/<slug>` entry fails the prereq report. Create the account
  files (and apply the etl repo's `bootstrap/` for the state bucket, plus
  the VPC/Aurora/dagster-db-secret prerequisites its README documents)
  first.
- Seed data. The ontology change set, identity bootstrap, and projector
  drain/deposit sequence remain the engineer-run recipe (commissioning
  gate is a named follow-up).
