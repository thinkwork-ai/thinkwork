---
title: "Skill creator drafts publish through a trust-gated catalog boundary"
date: 2026-06-22
category: docs/solutions/architecture-patterns/
module: Skill Creator / Skill Library
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "A /skill-creator chat creates a skill that should enter the tenant Skill Library"
  - "An operator reviews, publishes, replaces, or rejects a generated skill draft"
  - "SkillSpector or release-evidence checks block a draft or catalog skill"
  - "Upstream skill-creator assets need to be refreshed from their source repository"
related_components:
  - graphql-api
  - agentcore-pi
  - skill-catalog
  - skill-trust-runner
  - settings-ui
  - workspace-defaults
tags:
  - thnk-11
  - skill-creator
  - skill-library
  - skill-trust
  - skillspector
  - upstream-sync
  - operator-review
---

# Skill creator drafts publish through a trust-gated catalog boundary

## Context

THNK-11 made skill creation a two-stage workflow. A thread user can invoke
`/skill-creator`, produce skill files in the agent workspace, and submit those
files as a tenant-scoped draft. The generated files do not become an installed
catalog skill until a tenant operator publishes them from Settings -> Skill
Library -> Drafts.

That boundary is deliberate. Chat authors can iterate quickly, but the Skill
Library remains an operator-controlled catalog. Publication re-validates the
draft content, runs the SkillSpector-backed trust pipeline against the exact
staged files, handles slug replacement explicitly, seeds bundled eval cases,
and only then writes into:

```text
tenants/<tenant-slug>/skill-catalog/<skill-slug>/
```

The original draft files stay under the draft prefix:

```text
tenants/<tenant-slug>/skill-drafts/<draft-id>/
```

Published catalog copies are snapshots. Later edits to a draft or to upstream
creator assets do not mutate an already published catalog skill. Publish again
through the operator path to replace an existing catalog slug.

## Operating Model

Treat these as separate records and storage zones:

- **Workspace output:** During a `/skill-creator` turn, the Pi runtime writes
  files such as `skills/<slug>/SKILL.md` into the agent workspace projection.
- **Skill draft:** Finalize bridges one generated `skills/<slug>/SKILL.md`
  folder into `skill_drafts` plus S3 draft files. Draft rows keep requester,
  source thread, source message, status, slug, content hash, failure message,
  and metadata.
- **Catalog skill:** Operator publish copies validated draft files into
  `skill-catalog/<slug>/` and reindexes the tenant catalog. Runtime skill
  loading uses the catalog copy, not the draft prefix.
- **Thread status card:** The assistant message that registered a draft carries
  compact `metadata.skillDraft`. The transcript renders this as the author-facing
  status card. Do not rely on card text for authorization; it is a UX breadcrumb.

Only tenant owners/admins should publish, reject, or replace draft skills. The
current resolver path uses the tenant-admin guard before those mutations. If a
future API adds another publish-like action, it must re-use the same operator
gate rather than trusting client role state.

## Trust Pipeline

The v1 trust pipeline is synchronous at publish time and on-demand for catalog
detail pages:

- Draft publish calls `publishSkillDraftToCatalog`, which reads files from the
  draft prefix, validates the Agent Skills archive shape, runs SkillSpector, and
  builds a `SkillTrustPipelineReport`.
- Catalog detail "Skill trust" calls the workspace-files action
  `run-skill-trust` for a catalog slug. It reads the existing catalog prefix,
  runs the same scanner/report builder, and returns the report to the side sheet.
- The deployed runner is the Lambda function
  `thinkwork-<stage>-skill-trust-runner`, packaged from
  `packages/skill-trust-runner`. It invokes `skillspector scan <skill-dir>
--no-llm --format json`.

The report contains:

- `contentHash`: hash of the exact file list and contents scanned.
- `spec`: parsed `SKILL.md` status, name, description, declared tools, and
  validation errors.
- `scanner`: SkillSpector status/version/risk data or a fail-closed error.
- `severityCounts` and `findings`: normalized SkillSpector findings.
- `evidence`: skill card, eval dataset, benchmark, and signature presence.
- `artifactPaths`: paths for the release-evidence files found in the skill.

Publication is blocked when:

- The draft is not `submitted`.
- Draft files are empty or invalid.
- `SKILL.md` name does not match the draft slug.
- SkillSpector is not configured or fails.
- The trust report status is `blocked`, which currently means at least one
  critical or high SkillSpector finding.
- The catalog slug already exists and the operator has not confirmed replace.

Medium, low, and info findings are surfaced for review but do not block publish
in the current implementation. Missing release evidence such as `skillCard`,
`evalDataset`, `benchmark`, or `signature` is summarized in the trust report.
Today publish readiness is primarily enforced by spec validity, SkillSpector
completion, and blocking severity counts.

Catalog detail pages also expose recovery controls for missing release
evidence. Open Settings -> Skill Library -> a published skill -> shield button,
run the pipeline, then click any trust row. The row opens a second side sheet
with the step purpose, current state, detected artifact path, content hash, and
the available fix action. Missing skill card, eval dataset, and benchmark
evidence can be generated from this sheet. Signature generation is only enabled
when signing configuration is present; otherwise the sheet must explain that no
real `skill.oms.sig` can be produced in the current environment.

The published Skill Detail header also has a document icon for the skill card.
If `skill-card.md` exists, it opens as a read-focused side sheet so operators
can understand the skill without hunting through the file tree. If it is
missing, the icon routes the operator into the Skill Card trust step and runs
the pipeline first when no report has been generated in the current session.

## Evidence And Recovery

When publish fails, start with the error code returned by
`publishSkillDraft`. Most operator-visible failures include the trust report in
the GraphQL error details or the UI toast context. For catalog skills, rerun
the side sheet pipeline from Settings -> Skill Library -> the skill -> shield
button.

Useful locations:

```text
Draft files:
tenants/<tenant-slug>/skill-drafts/<draft-id>/

Catalog files:
tenants/<tenant-slug>/skill-catalog/<skill-slug>/

Upstream skill-creator defaults:
packages/workspace-defaults/files/skills/skill-creator/

Upstream provenance:
packages/workspace-defaults/files/skills/skill-creator/UPSTREAM.json

Generated default-workspace mirror:
packages/workspace-defaults/src/index.ts
```

Recovery paths:

- **Missing skill card:** From the Skill Detail document icon or shield sheet,
  open the Skill Card trust detail and generate the missing component. The
  generated `skill-card.md` is the human-readable operator summary artifact:
  summary first, then ownership, intended use, declared tools, and review notes.
- **Missing eval dataset:** Open the Evals trust detail and generate the starter
  eval artifact. Treat these as smoke coverage that must be reviewed and
  expanded before relying on the skill in production.
- **Missing benchmark:** Open the Benchmark trust detail and generate the
  benchmark readiness artifact. This records measurement expectations without
  inventing pass rates.
- **Missing signature:** Generate only when signing is configured. In local/dev
  stacks without a signer, the Signature trust detail should show the missing
  signing prerequisite instead of offering a fake signature.
- **`skillspector_required`:** Confirm the deploy includes
  `thinkwork-<stage>-skill-trust-runner`. In Terraform state the function lives
  at
  `module.thinkwork.module.api.aws_lambda_function.skill_trust_runner[0]`.
  The GraphQL Lambda invokes it with `RequestResponse`.
- **Runner image build failure:** Check
  `packages/skill-trust-runner/Dockerfile`. The Docker build context is the
  repository root, so `COPY` paths must be repository-root relative.
- **`skill_md_not_found` on catalog trust:** The catalog prefix exists but lacks
  `SKILL.md`. Inspect the S3 prefix and re-publish or replace the catalog entry
  from a valid draft/archive.
- **Critical/high findings:** Treat as a block. Update the draft files through
  the draft editing path, resubmit, and publish again. Do not copy files around
  the publish function to bypass the scanner.
- **Slug collision:** Re-run publish with explicit replace confirmation only
  after the operator verifies that replacing the existing catalog skill is
  intended. Runtime agents use catalog slugs, so replacement changes future
  skill loads for that tenant.
- **Generated draft lacks required YAML:** Continue the `/skill-creator` thread
  and ask it to fix the skill. Finalize registers only one generated
  `skills/<slug>/SKILL.md` folder per submit-intent turn.

There is no durable `skill_trust_runs` table in the shipped v1 path. If a
future implementation adds durable trust-run rows, keep the content-hash rule:
evidence only applies to the exact hash it scanned.

## Upstream Skill-Creator Refresh

The upstream skill-creator assets are mirrored into workspace defaults, not
recreated by hand. Refresh them with:

```bash
tsx scripts/sync-upstream-skill-creator.ts
```

The script fetches the configured upstream source from
`packages/api/src/lib/skill-creator/upstream-sources.ts`, rewrites
`packages/workspace-defaults/files/skills/skill-creator/`, regenerates
`UPSTREAM.json`, updates the generated constants in
`packages/workspace-defaults/src/index.ts`, and bumps `DEFAULTS_VERSION`.

Reviewer checklist for an upstream refresh:

- Read `UPSTREAM.json` and record the old and new upstream commit SHAs.
- Review file diffs under `packages/workspace-defaults/files/skills/skill-creator/`.
- Confirm the license remains compatible with the repo's Apache-2.0 CI policy.
- Run the upstream-source tests and workspace-defaults build/typecheck.
- Run a `/skill-creator` smoke after deploy before calling the refresh complete.
- Do not edit generated constants in `packages/workspace-defaults/src/index.ts`
  by hand; rerun the sync script instead.

Do not add a public CLI refresh surface as part of THNK-11. The script is the
v1 operator/developer refresh path. If operators need a supported refresh
button or CLI after first use, open a follow-up with the required audit trail
and approval model.

## Verification Checklist

An end-to-end THNK-11 verification should prove:

1. A user invokes `/skill-creator` in chat and submits a draft.
2. The assistant message shows the skill draft status card in the thread.
3. Settings -> Skill Library -> Drafts shows the submitted draft to an
   operator.
4. Publishing a draft with blocking SkillSpector findings fails closed.
5. Publishing a valid draft runs SkillSpector, writes the catalog prefix, and
   updates the catalog index.
6. A follow-up chat invokes the newly published skill and returns a marker that
   proves the skill was selected.
7. The Skill Detail shield side sheet can run the trust pipeline for an
   existing catalog skill from `http://localhost:<port>` using the authenticated
   `localhost` origin, not `127.0.0.1`.
8. A missing trust row opens the step-detail side sheet and can generate at
   least one non-signature artifact, then a refreshed report shows the step as
   present or starter-generated.
9. The published Skill Detail document icon opens `skill-card.md`; when the
   card is missing, it routes to the Skill Card trust detail and generation
   path.
10. Archive upload/import places the submitted files in Drafts first; it must
    not automatically register the archive in the published catalog.
11. A Drafts row opens the draft detail editor, and the draft detail header uses
    the publish icon as the governed publish path.

For local web validation in a worktree, copy the ignored env file first:

```bash
cp /Users/ericodom/Projects/thinkwork/apps/web/.env apps/web/.env
pnpm --dir apps/web exec vite --host 127.0.0.1 --port 5175
```

Open the app as `http://localhost:5175/...`. Cognito callback URLs are
origin-sensitive; `127.0.0.1` can land on sign-in even when `localhost` is
already authenticated.

Suggested local validation route:

1. Open
   `http://localhost:5175/settings/skills/account-health-review`.
2. Click the shield icon, run the trust pipeline, and confirm the parent Skill
   Trust side sheet opens.
3. Click a missing non-signature row such as Skill Card, Evals, or Benchmark.
   Confirm the step-detail side sheet opens at the same width as the parent
   Skill Trust sheet.
4. Click **Generate missing component**, then confirm the refreshed report shows
   that step as `present` or `starter generated`.
5. Click the Signature row. In an unsigned local stack, confirm the detail sheet
   explains that signing configuration is missing and does not offer a fake
   signature.
6. Click the document icon in the published Skill Detail header. Confirm it
   opens `skill-card.md` when present, or routes to the Skill Card trust detail
   when absent.
7. From Skill Library, switch to Drafts, click a draft row, and confirm it opens
   the draft detail editor with a publish icon in the header.
8. Upload/import a skill archive and confirm the result appears under Drafts
   rather than Published until an operator publishes it.

## When To Apply

Use this runbook when:

- Debugging why a generated skill appeared in chat but not the Skill Library.
- Explaining why an author can draft but cannot publish.
- Investigating a failed SkillSpector scan or missing release evidence.
- Replacing an existing tenant catalog skill from a generated draft.
- Refreshing upstream skill-creator assets.
- Verifying THNK-11 after a deploy.

Do not use draft S3 files as a runtime install source. The runtime should
consume published catalog skills only. The draft area is review state; the
catalog area is the executable contract.

## Related

- [THNK-11](https://linear.app/thinkworkai/issue/THNK-11)
- [Skill Creator System Plan](../../plans/2026-06-21-003-feat-skill-creator-system-plan.md)
- [Skill eval datasets can be rated before they are evaluable](./skill-eval-rated-does-not-mean-evaluable-2026-06-15.md)
- [Stale localhost Vite server from detached checkout](../developer-experience/stale-localhost-vite-server-detached-checkout-2026-06-05.md)
