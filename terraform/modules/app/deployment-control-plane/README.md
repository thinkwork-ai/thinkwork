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

Managed applications are intentionally disabled in this runner path:
`enable_cognee = false`, `twenty_provisioned = false`, and
`twenty_runtime_enabled = false`. Cognee/Twenty lifecycle remains owned by the
managed-application deployment flow.
