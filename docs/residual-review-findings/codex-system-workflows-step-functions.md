---
source: ce-code-review
branch: codex/system-workflows-step-functions
plan: docs/plans/2026-05-02-007-feat-system-workflows-step-functions-plan.md
created: 2026-05-02
---

## Residual Review Findings

- P1 `packages/api/src/graphql/resolvers/system-workflows/queries.ts:1` Add live System Workflow launcher and adapters — filed as https://github.com/thinkwork-ai/thinkwork/issues/764. The follow-up slice in `docs/plans/2026-05-02-008-feat-system-workflow-runtime-eval-adapter-plan.md` adds the launcher, callback handlers, domain-ref dedupe, and a Standard-parent Evaluation Runs adapter. Remaining work under this residual is Express evaluation batching plus the Wiki Build and Tenant/Agent Activation adapters.
