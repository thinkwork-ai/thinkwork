---
title: Current Planning Index
date: 2026-05-26
status: active
---

# Current Planning Index

This index reconciles the high-churn brainstorms and plans from May 19-26, 2026. Use this file before treating an older brainstorm or plan as the current implementation direction.

## Trust Order

1. Shipped code and merged PRs are the source of truth.
2. A doc with `status: completed` is historical evidence, not an open implementation plan.
3. A doc with `status: superseded` is background only; prefer its `superseded_by` target where the two disagree.
4. If two active docs conflict, prefer the newer doc only after checking whether it names the older doc in `origin`, `superseded_by`, or the body text.

## Canonical Product References

| Area | Current reference | Notes |
| --- | --- | --- |
| Spaces product model | `docs/brainstorms/2026-05-20-spaces-as-agent-context-modules-template-removal-requirements.md` | Prefer "Agent in Space" / contextual workroom language over older template-parent or generic collaboration-room framing. |
| Admin Spaces UI | `docs/plans/2026-05-26-002-feat-admin-spaces-ui-cleanup-plan.md` | Shipped in PR #1735. Supersedes the May 21 Space Studio tab/order labels where they conflict. |
| Customer onboarding demo | `docs/brainstorms/2026-05-19-spaces-customer-onboarding-v1-requirements.md` | Requirements remain useful, but the May 25-26 implementation plans are completed. New work should start from current code behavior and fresh follow-up docs. |
| Thread attachments | `docs/plans/2026-05-26-003-feat-spaces-thread-attachments-plan.md` | Shipped in PR #1740. Treat as completed baseline, not pending work. |
| Email markdown rendering | `docs/plans/2026-05-24-003-feat-channel-rendering-email-markdown-plan.md` | Shipped in PR #1665 and patched for the agent email endpoint in PR #1745. |
| Desktop app chrome | `docs/plans/2026-05-26-004-fix-desktop-chrome-polish-plan.md` | Shipped in canary.31 with top-offset follow-up in canary.33. |
| Folder-is-agent alignment | `docs/plans/2026-05-24-004-refactor-folder-is-the-agent-thinkwork-alignment-plan.md` | Completed by the folder canon cleanup series. |

## Recently Completed Plans

| Plan | Completion evidence |
| --- | --- |
| `docs/plans/2026-05-24-003-feat-channel-rendering-email-markdown-plan.md` | PR #1665, PR #1745 |
| `docs/plans/2026-05-24-004-feat-space-detail-members-and-folder-structure-plan.md` | PR #1652, PR #1735 |
| `docs/plans/2026-05-24-004-refactor-folder-is-the-agent-thinkwork-alignment-plan.md` | PR #1679, PR #1680 |
| `docs/plans/2026-05-25-003-feat-docs-applications-section-plan.md` | commit c94e7131 |
| `docs/plans/2026-05-25-004-feat-customer-onboarding-native-checklist-plan.md` | PR #1699, PR #1728 |
| `docs/plans/2026-05-25-005-fix-customer-onboarding-progress-workflow-plan.md` | PR #1710, PR #1722, PR #1744 |
| `docs/plans/2026-05-25-006-feat-thread-progress-md-plan.md` | PR #1719, PR #1722 |
| `docs/plans/2026-05-26-001-feat-spaces-info-panel-progress-style-alignment-plan.md` | PR #1733, PR #1736 |
| `docs/plans/2026-05-26-002-feat-admin-spaces-ui-cleanup-plan.md` | PR #1735 |
| `docs/plans/2026-05-26-003-feat-spaces-thread-attachments-plan.md` | PR #1740 |
| `docs/plans/2026-05-26-004-fix-desktop-chrome-polish-plan.md` | commit b9cd502f, commit 040da7c0 |

## Still Needs A Fresh Decision

These docs were not marked completed during this refresh because the pass did not find enough direct completion evidence in recent merge history:

- `docs/plans/2026-05-19-001-feat-hindsight-primary-user-memory-plan.md`
- `docs/plans/2026-05-19-002-feat-one-line-enterprise-deploy-plan.md`
- `docs/plans/2026-05-19-002-feat-ontology-gated-hindsight-wiki-plan.md`
- `docs/plans/2026-05-20-001-fix-agent-mentions-and-unread-routing-plan.md`
- `docs/plans/2026-05-20-004-feat-computer-artifact-side-panel-plan.md`
- `docs/plans/2026-05-21-002-feat-admin-user-workspace-and-message-identity-plan.md`
- `docs/plans/2026-05-21-006-feat-microsoft-teams-bot-think-plan.md`
- `docs/plans/2026-05-21-007-refactor-space-schema-cleanup-plan.md`
- `docs/plans/2026-05-22-002-fix-artifact-builder-upgradable-sha-backfill-plan.md`
- `docs/plans/2026-05-22-003-fix-desktop-downloadable-release-artifact-plan.md`
- `docs/plans/2026-05-22-004-fix-chart-color-validator-and-saved-app-scroll-plan.md`
- `docs/plans/2026-05-22-006-refactor-chat-agent-invoke-direct-callback-finalize-plan.md`
- `docs/plans/2026-05-23-001-docs-space-architecture-agent-framework-user-docs-plan.md`
- `docs/plans/2026-05-23-003-feat-workspace-filetree-cut-paste-drag-plan.md`
- `docs/plans/2026-05-23-005-feat-workspace-filetree-inline-rename-create-plan.md`
- `docs/plans/2026-05-23-006-feat-agentcore-pi-mcp-proxy-tool-plan.md`
- `docs/plans/2026-05-23-007-feat-editor-driven-agents-md-section-regen-plan.md`
- `docs/plans/2026-05-23-007-refactor-hitl-u2-admin-workspace-reviews-route-removal-plan.md`
- `docs/plans/2026-05-24-001-feat-workspace-filetree-inline-focus-plan.md`

Before implementing one of these, reread the current code and either update the plan or create a narrow successor plan.
