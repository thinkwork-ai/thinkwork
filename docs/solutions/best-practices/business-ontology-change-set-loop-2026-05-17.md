---
title: Business ontology changes should flow through evidence-backed change sets
date: 2026-05-17
category: docs/solutions/best-practices
module: Business Ontology
problem_type: best_practice
component: ontology
severity: high
applies_when:
  - "A feature turns inferred memory patterns into durable business schema"
  - "Operators need to approve generated types, relationships, mappings, or templates"
  - "A future ontology layer could be built for agent-work, vertical packs, or ETL"
tags: [ontology, company-brain, hindsight, suggestions, reprocess, admin]
---

# Business ontology changes should flow through evidence-backed change sets

## Context

The Company Brain wiki was useful but too loose as the durable business layer. Hindsight retained facts, and the wiki compiler summarized them, but there was no governed place to say which business concepts the tenant actually recognizes, which facets belong on those pages, or how external standards should map to product-native names.

The tempting fix was to import a large ontology or let the compiler invent typed concepts directly. Both paths make the same mistake: they skip the operator review point. A tenant's real vocabulary emerges from memory, but only approved concepts should change future and historical Brain materialization.

## Guidance

Use a change-set loop for ontology evolution:

- scan real source material and current Brain pages for recurring patterns;
- group related findings into a change set with confidence, frequency, impact, and evidence examples;
- let operators edit, remove, hold, approve, or reject individual items;
- apply approved items into durable ontology definitions;
- queue an async reprocess job that materializes the approved definitions into Brain pages/facets;
- keep the job ledger visible so partial application, failure, and retry are operational states.

Keep the canonical vocabulary product-native. External standards belong in mapping rows:

- Schema.org-style mappings help integrations and exports;
- SKOS-style mapping kinds (`EXACT`, `CLOSE`, `BROAD`, `NARROW`, `RELATED`) describe relationship to the outside vocabulary;
- PROV-O-inspired provenance keeps source kind, source reference, source label, evidence quote, and observation time;
- Dublin Core-style labels/descriptions are metadata, not a reason to rename tenant concepts.

Do not mix ontology domains too early. The business/domain ontology belongs in core ThinkWork because it shapes Company Brain. Agent-work ontology can come later through Symphony ETL or another vertical-pack flow, but it should reuse the same suggestion/change-set/reprocess pattern.

## Why This Matters

An ontology is a multiplier. A bad type or relationship does not just create one bad page; it changes future retrieval, page templates, agent context, and operator expectations. The change-set loop gives the system a way to propose structure without silently turning model guesses into durable schema.

Separating approval from application is equally important. The ontology can be approved while reprocessing is pending or failed. Operators need to know which state they are looking at so they can recover without hand-editing production rows.

## When to Apply

- When adding a new ontology-backed materialization path.
- When generating schema suggestions from Hindsight, Brain pages, imports, or vertical packs.
- When future Symphony ETL introduces agent-work concepts.
- When adding external vocabulary mappings to a tenant-native concept.
- When a reprocess job can partially update durable derived state.

## Examples

Good change-set item:

```text
Entity type: customer
Aliases: client, account
Facet templates: Overview, Commitments, Risks, Stakeholders
Evidence: five cited source observations across three customer conversations
Mapping: BROAD Schema.org Organization
```

Poor direct schema write:

```text
Create Customer because the model saw the word "customer" once.
Rewrite existing pages immediately.
No source citations.
No operator approval.
```

Good rollout behavior:

```text
Approve change set -> create active ontology version -> queue reprocess job.
Definitions show approved immediately.
Brain pages update only after the job succeeds.
Failure leaves the job row with error, impact, and retry path.
```

Poor rollout behavior:

```text
Approve button rewrites pages inline and reports success even if half the pages failed.
```

## Related

- [Business Ontology concept](../../src/content/docs/concepts/knowledge/business-ontology.mdx)
- [Business Ontology operations guide](../../src/content/docs/guides/business-ontology-operations.mdx)
- [Company Brain compile pipeline](../../src/content/docs/concepts/knowledge/compounding-memory-pipeline.mdx)
- [Context Engine adapters need operator-level verification](./context-engine-adapters-operator-verification-2026-04-29.md)
