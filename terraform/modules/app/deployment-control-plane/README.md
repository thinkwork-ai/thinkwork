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
