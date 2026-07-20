# Deployment Control Plane

AWS-native substrate for GitHub-free ThinkWork deployments.

This module provisions the durable control plane for customer-owned deployments:

- Step Functions state machine for deployment orchestration.
- CodeBuild project with a release-pinned Terraform runner.
- S3 evidence bucket for logs, plans, approvals, and smoke artifacts.
- CloudWatch log groups for runner and state-machine history.
- AppConfig application/environment/profile for non-secret deployment config.
- SSM parameters for stable selected-release metadata.
- Secrets Manager placeholder containers for bootstrap-managed secrets.

The runner accepts Step Functions input and writes evidence to
`sessions/<session>/<action>/deployment-evidence.json`. For platform
deployment actions it downloads the selected release manifest, stages release
Lambda artifacts into the customer-owned artifact bucket, runs Terraform
against the ThinkWork composite module, publishes static site bundles, and
writes deployment profile pointers under `/thinkwork/<stage>/deployment`.

For routine web-only redeploys, use controller action `web`. The runner
downloads and verifies the selected release manifest, materializes only the
`web` static-site artifact, reads the existing app bucket/distribution outputs
from Terraform state, syncs the web bundle, invalidates CloudFront, and records
evidence. It does not run Terraform init/plan/apply, stage Lambda artifacts,
copy runtime images, run database migrations, or update AgentCore runtimes.

Full deploy/update plans fail closed when they would delete customer-domain
resources or remove web CloudFront aliases unless
`allowCustomerDomainRemoval=true` is set for an intentional reviewed retirement.

## Node.js 22 control-runtime transition

The AgentCore control SDK requires Node.js 20 or newer, and the ThinkWork
toolchain requires Node.js 22 or newer. New and reconciled CodeBuild projects
therefore select Node.js 22 in the checked-in buildspec, and release CI executes
every packaged control-runtime entrypoint under that exact major.

An established deployment whose live CodeBuild project still embeds the older
Node.js 18 buildspec upgrades in 2 managed stages. First, the existing Python
runner loads the ESM-bounded release under Node.js 18 only long enough to produce
and apply an independently accepted Terraform plan. That transition must perform
no AgentCore SDK API operation; the plan may only update CodeBuild to Node.js 22
in place alongside the intended application changes, with zero delete or replace
actions. Then read back the live buildspec, refresh the runner through the
release-remediation API using the manifest's standalone runner asset and digest,
and rerun the controller under Node.js 22. Do not claim Node.js 18 support from
this bounded transition. Subsequent updates are entirely Terraform-owned.

Platform deploys stay on the root Terraform state key:
`thinkwork/<stage>/terraform.tfstate`.

Targeted managed-application operations are controller-owned. Before the
managed-app state migration, they continue to use the root backend so existing
state remains authoritative. After a reviewed `terraform state mv`/import
migration for an app, set `THINKWORK_MANAGED_APP_STATE_ISOLATION=true` or pass
`features.managedAppStateIsolation=true` for that app operation. The runner
then uses `thinkwork/<stage>/managed-apps/<appKey>/terraform.tfstate` and the
default Terraform workspace, giving the app an independent S3 object and lock
scope.

Do not enable per-app state isolation for a live app until its resources have
been moved out of root state and the per-app plan is verified no-op. Otherwise
Terraform will see an empty app state and attempt to recreate resources.
