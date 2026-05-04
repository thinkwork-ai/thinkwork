---
title: "feat: Deploy and smoke activation System Workflow adapter"
type: feat
status: completed
date: 2026-05-02
origin: docs/plans/2026-05-02-010-feat-activation-system-workflow-adapter-plan.md
---

# feat: Deploy and smoke activation System Workflow adapter

## Overview

Merge PR #771, let the merged `main` deploy run to `dev`, and run a real end-to-end smoke for the `tenant-agent-activation` System Workflow adapter.

## Requirements Trace

- R1. PR #771 is merged only after its required checks are green.
- R2. The merged commit deploys to `dev` through the normal GitHub Actions deploy workflow.
- R3. The smoke starts activation through the deployed GraphQL/API surface or an equivalent deployed trigger.
- R4. The smoke verifies the deployed chain: activation session -> `system_workflow_runs` -> Step Functions execution -> step events -> evidence rows.
- R5. If deployment or smoke fails, diagnose and fix rather than reporting success.

## Scope Boundaries

- Do not add new product behavior unless deploy/smoke reveals a bug.
- Do not touch unrelated Symphony files currently present in the worktree.
- Do not run local-only e2e as a substitute for deployed AWS verification.

## Implementation Units

- U1. **Merge PR #771**

**Goal:** Merge the activation adapter PR once checks are green.

**Files:** Test expectation: none -- operational merge step.

**Verification:** PR is merged into `main`, branch deletion succeeds, and local `main` can be fast-forwarded.

- U2. **Monitor dev deploy**

**Goal:** Confirm the merged commit deploys to `dev` through the normal pipeline.

**Files:** Test expectation: none -- GitHub Actions deployment step.

**Verification:** Deploy workflow completes successfully, including Terraform Apply and migration drift gates.

- U3. **Run activation workflow smoke**

**Goal:** Exercise the deployed activation adapter end to end.

**Files:** Test expectation: none -- deployed smoke.

**Verification:** A `tenant-agent-activation` System Workflow run succeeds, with Step Functions status `SUCCEEDED`, expected step events, and `activation-timeline` / `launch-approval` evidence rows.
