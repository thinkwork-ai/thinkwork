---
title: "feat: Legacy-industrial integration outcomes first slice"
type: feat
status: completed
date: 2026-05-15
origin: LFG request after Agentic ETL / integration outcomes brainstorm
---

# Feat: Legacy-Industrial Integration Outcomes First Slice

## Overview

Create the first dogfoodable slice of ThinkWork's legacy-industrial integration outcome offer: a Computer runbook skill that produces an executive operator account briefing from ERP sales, CRM, and fleet-management context.

This PR should not try to build the full deterministic ETL substrate yet. The first slice should make the desired outcome concrete inside the existing agent harness: a reusable runbook contract, source-discovery guidance, synthesis rules, an artifact schema, and focused tests that prove the skill is installable and routeable like the existing Computer runbooks.

## Problem Frame

ThinkWork already has contracts with legacy-industrial customers whose ERP, CRM, fleet, and other systems do not speak to each other. The strategic offer is not selling an ETL tool. ThinkWork delivers and operates integration outcomes: extracting governed enterprise context into the customer's AWS account, using agents to accelerate buildout and maintenance, and then using that catalog to power valuable workflows.

The first workflow is an executive operator briefing. It should answer: what changed across important accounts, revenue, CRM activity, and fleet/service capacity that needs executive attention today?

The first implementation should prove the agent-harness side of the story before introducing new infrastructure: Computer can run a reusable workflow that expects governed ERP/CRM/fleet context, degrades honestly when a source is absent, and produces a dense operator-facing briefing artifact or summary.

## Requirements Trace

- R1. Add a catalog skill named `industrial-account-briefing` for the executive operator briefing workflow.
- R2. The skill must be a `computer-runbook` and carry a valid `references/thinkwork-runbook.json` contract.
- R3. The workflow must explicitly gather three source families: ERP sales, CRM activity/pipeline, and fleet-management capacity/service signals.
- R4. The workflow must require source-grounded claims and must label missing or unavailable source families instead of fabricating context.
- R5. The output must be executive-operator oriented: exceptions, risks, opportunities, contradictions, and recommended next actions, not a sales-rep prep memo.
- R6. The output should prefer an inspectable artifact when available and allow a compact Markdown brief as a fallback.
- R7. Tests must pin the new runbook contract and its source-family requirements so future catalog changes do not silently dilute the proof.

## Scope

### In Scope

- New `packages/skill-catalog/industrial-account-briefing/` skill.
- Runbook contract at `packages/skill-catalog/industrial-account-briefing/references/thinkwork-runbook.json`.
- Phase guidance for discovering source coverage, synthesizing an operator brief, and producing an artifact or fallback summary.
- JSON schema asset describing the expected briefing dataset.
- Skill-catalog tests that validate the runbook contract and source-family guidance.
- Local validation with focused skill-catalog tests and the catalog validator.

### Out of Scope

- Provisioning Dagster, dbt, Iceberg, Glue, Athena, or any new AWS data-lake infrastructure.
- Implementing real ERP, CRM, or fleet connectors.
- Moving Symphony runtime/API code into the OSS monorepo.
- Reintroducing the retired OSS connector model.
- Building a Symphony ETL admin UI in this PR.
- Making LLMs part of deterministic data movement.

## Context And Research

### Repo Patterns

- `packages/skill-catalog/crm-dashboard/` is the closest Computer runbook precedent: `SKILL.md`, `references/thinkwork-runbook.json`, phase guidance, and an asset schema.
- `packages/skill-catalog/__tests__/runbook-skill-contract.test.ts` validates runbook-capable skill contracts for selected catalog slugs.
- `scripts/validate-skill-catalog.sh` validates supported `execution` values and tenant-specific string leaks.
- `docs/plans/2026-05-14-001-refactor-retire-oss-symphony-connectors-plan.md` removed OSS connectors and requires future integration work to avoid the retired connector runtime.
- `docs/plans/2026-05-14-003-feat-real-symphony-admin-extension-plan.md` confirms Symphony is a private Admin extension surface, not an OSS route or connector framework.
- `docs/POSITIONING.md` requires public surfaces to anchor on the agent harness, avoid generic "AI platform" language, and keep AWS ownership clear.

### External References

- Meltano manages Singer tap/target configuration, stream selection, and incremental state for deterministic ELT pipelines. This supports the later deterministic extraction layer but is not implemented in this slice.
- Dagster can model dbt assets and dbt tests as asset checks, which supports later run-evidence and review-agent loops.
- AWS Glue supports working with Iceberg tables in S3 and the Glue Data Catalog, making S3/Iceberg/Glue/Athena a plausible first lakehouse target for later phases.

## Technical Decisions

### D1: Skill First, Infrastructure Later

The first shippable unit should be a runbook skill because it exercises ThinkWork's existing agent harness today. It creates a concrete workflow contract that later pipeline infrastructure can feed.

### D2: Treat ERP/CRM/Fleet As Source Families

Do not encode a specific customer, vendor, or schema into the skill. The skill should ask for or discover source-family coverage and then map available fields into a normalized briefing dataset.

### D3: Executive Operator, Not Sales Assistant

The brief should prioritize exceptions, risk, contradictions, operational constraints, and suggested executive actions. Existing account-health and CRM dashboard skills are adjacent, but this runbook needs a distinct operator audience.

### D4: Honest Degradation Is A Feature

The skill should be useful with partial source coverage while making missing inputs visible. Missing fleet data, for example, should produce a source note, not invented capacity claims.

## Implementation Units

### U1: Add The Industrial Account Briefing Skill

**Goal:** Add the catalog skill and top-level instructions for the executive operator briefing.

**Files:**

- `packages/skill-catalog/industrial-account-briefing/SKILL.md`

**Approach:**

- Use `execution: context`.
- Mark the skill as `metadata.thinkwork_kind: computer-runbook`.
- Add routing examples around executive account briefings, industrial account review, ERP/CRM/fleet context, and daily operator briefings.
- State the three source families and the no-fabrication rule in the primary prompt.
- Direct the agent to load the runbook contract and phase guidance rather than doing free-form analysis.

**Test Scenarios:**

- Existing SKILL frontmatter tests parse the new skill and verify `name` matches the directory slug.
- Catalog validator accepts the skill's `execution` value.

### U2: Add Runbook Contract, Phase Guidance, And Dataset Schema

**Goal:** Give Computer a concrete phased workflow and a stable briefing-data shape.

**Files:**

- `packages/skill-catalog/industrial-account-briefing/references/thinkwork-runbook.json`
- `packages/skill-catalog/industrial-account-briefing/references/discover.md`
- `packages/skill-catalog/industrial-account-briefing/references/synthesize.md`
- `packages/skill-catalog/industrial-account-briefing/references/produce.md`
- `packages/skill-catalog/industrial-account-briefing/assets/industrial-account-briefing-data.schema.json`

**Approach:**

- Define three phases:
  - `discover`: identify available ERP sales, CRM, and fleet source coverage.
  - `synthesize`: normalize findings into executive-operator briefing data.
  - `produce`: create an inspectable artifact when possible, otherwise return a compact Markdown brief.
- Keep phase guidance deterministic and bounded. No broad data hunting, no claims without cited sources.
- The schema should include source coverage, account signals, revenue/margin signals, CRM signals, fleet/service signals, contradictions, recommended actions, and source notes.

**Test Scenarios:**

- Runbook contract validation passes with all referenced guidance and asset files present.
- Contract phases use only supported capability roles.

### U3: Pin The New Runbook In Tests

**Goal:** Make the new workflow durable in the catalog test suite.

**Files:**

- `packages/skill-catalog/__tests__/runbook-skill-contract.test.ts`

**Approach:**

- Add `industrial-account-briefing` to the validated runbook skill list or add a targeted test for it.
- Add a targeted test that reads the new `SKILL.md` and guidance files and asserts they include the required ERP, CRM, fleet, executive operator, source coverage, and missing-source degradation terms.

**Test Scenarios:**

- `pnpm --filter @thinkwork/skill-catalog test -- __tests__/runbook-skill-contract.test.ts` passes.
- `bash scripts/validate-skill-catalog.sh` passes.

## Verification Plan

- `pnpm --filter @thinkwork/skill-catalog test -- __tests__/runbook-skill-contract.test.ts`
- `pnpm --filter @thinkwork/skill-catalog test -- __tests__/skill-md-frontmatter.test.ts`
- `bash scripts/validate-skill-catalog.sh`

## Risks And Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The slice feels too small compared with the full integration-outcomes vision | Name this explicitly as the first dogfoodable workflow contract; keep Dagster/dbt/Iceberg as later phases. |
| The skill overlaps with `account-health-review` or `crm-dashboard` | Keep the audience and source mix distinct: executive operator, ERP sales + CRM + fleet, contradictions and next actions. |
| The skill implies real connectors exist today | Require source coverage notes and missing-source degradation. Do not claim live connector availability. |
| Public docs drift into vertical marketing claims | Keep this implementation in the skill catalog and plan docs; avoid changing public positioning copy in this slice. |

## Done Criteria

- The new `industrial-account-briefing` skill exists and is valid catalog content.
- The runbook contract validates with all referenced files present.
- The workflow explicitly covers ERP sales, CRM, and fleet-management context.
- Tests pin both the runbook contract and the required source-family/operator briefing guidance.
- Focused validation commands pass.
