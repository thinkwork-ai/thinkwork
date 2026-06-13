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

## Evaluations

### Verdict taxonomy
Every eval result is exactly one of `pass`, `fail`, or `error`. `pass`/`fail` are behavioral judgments of the agent; `error` is an infrastructure outcome (timeout, throttle, evaluator/judge crash, reconciler-closed) carrying a cause, and is excluded from the pass rate. A run's score is computed over clean executions only — errors surface separately as run health, never dragging down the behavioral number. Runs scored before this taxonomy are marked "legacy scoring" and excluded from trend averages rather than silently reinterpreted.

### Eval replay
Re-sending a recorded thread's request to today's agent and scoring the fresh response — a regression test that answers "is the system fixed now?". Distinct from trace judgment (scoring the already-recorded conversation, an audit of the past). Replay is read-only by construction: outbound side-effect tools are always stripped and MCP tools are gated to read-only, so re-running a past request never re-executes its writes.

### Flagged-thread case
An eval case created by an operator flagging a production thread with a bad outcome (security or quality). It captures a self-contained flag-time snapshot (message history, the projected workspace, tool traces when available) plus a Resolution Target, and survives deletion of the source thread.

### Resolution target
What should have happened, recorded by the operator at flag time. It becomes the rubric the judge scores the replayed output against — required, because without it a re-run has nothing to score.

### Scoring engine
The ThinkWork-owned contract (case + agent response in, verdicts out) behind which scoring backends plug. The in-house scorer (deterministic assertions + LLM-rubric judge) is engine #1; an AgentCore Evaluations adapter exists gated-off as the documented activation seam. The dataset format and verdict taxonomy are engine-neutral — engine-specific concepts never leak into them.

### Eval dataset
A per-tenant, versioned collection of eval cases stored as an S3 artifact with a derived DB index. Each tenant gets a `baseline-red-team` dataset (the seeded red-team suite) at install; operators curate custom datasets by flagging threads. Case identity is stable across dataset versions so trend history survives.

## Flagged ambiguities

- "Deploy" had been used loosely for two distinct paths — the per-merge dev-stage pipeline and controller-managed customer deployments. These have different configuration surfaces and different release mechanics; the web app additionally publishes only on desktop release cuts, not per-merge.
