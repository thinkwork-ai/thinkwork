# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Managed Deployments

### Deployment Controller
The control plane installed in a customer's AWS account that applies release-pinned infrastructure changes: an orchestrator starts a build job that runs Terraform against a selected Release Manifest and records evidence of what it did. Customer environments managed this way are "controller-managed" — their configuration flows exclusively through Controller Input and Runner Secrets, never through hand-edited Terraform files.

### Deployment Runner
The script the Deployment Controller executes to perform one deployment run. It materializes a Terraform root module and its variable values from a fixed allowlist — a platform variable absent from the runner's wiring cannot be configured by any controller-managed deployment, and the omission fails silently rather than erroring. The runner also stages release artifacts, applies database migrations, and writes run evidence to the customer's evidence bucket.

### Controller Input
The structured payload a deployment run is started with — release selection, action, feature flags, and customer configuration values. Non-secret configuration belongs here; when the same value also appears in Runner Secrets, Runner Secrets win.

### Runner Secrets
A secrets-manager payload holding sensitive deployment values (credentials, operator identities) that the Deployment Runner reads at run time. Takes precedence over Controller Input for any value defined in both.

### Release Manifest
The JSON document that pins one Release: artifact locations, content hashes, runtime images, and the matching Terraform module version. Controller-managed deployments select a Release Manifest rather than a git ref; a trust policy decides whether unsigned (canary) manifests are deployable.

## Flagged ambiguities

- "Deploy" had been used loosely for two distinct paths — the per-merge dev-stage pipeline and controller-managed customer deployments. These have different configuration surfaces and different release mechanics; the web app additionally publishes only on desktop release cuts, not per-merge.
