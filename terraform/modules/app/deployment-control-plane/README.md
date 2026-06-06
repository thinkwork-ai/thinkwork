# Deployment Control Plane

AWS-native substrate for GitHub-free ThinkWork deployments.

This module is intentionally inert in U2. It provisions the durable resources
that later units use for managed-application plan/apply/destroy jobs:

- Step Functions state machine for deployment orchestration.
- CodeBuild project with a stub buildspec.
- S3 evidence bucket for logs, plans, approvals, and smoke artifacts.
- CloudWatch log groups for runner and state-machine history.
- AppConfig application/environment/profile for non-secret deployment config.
- SSM parameters for stable selected-release metadata.
- Secrets Manager placeholder containers for bootstrap-managed secrets.

The runner does not clone source or run Terraform yet. U4 adds the deployment job
domain and live orchestration contract; U5 wires Cognee and Twenty adapters.
