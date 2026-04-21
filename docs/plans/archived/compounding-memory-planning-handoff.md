# Compounding Memory Planning Handoff

This package is ready for implementation planning.

## What is settled

The architecture line is now clear:

- Raw operational history is upstream source data.
- The canonical memory warehouse is ThinkWork's normalized memory contract, backed by Hindsight in v1.
- The compiled layer is downstream, rebuildable, and Aurora-primary.
- Compiled pages in v1 are limited to `entity`, `topic`, and `decision`.
- Markdown is export, not operational truth.
- Unresolved mentions are a critical middle state between ignore and page creation.

## Docs to use

### Product framing and concept package
- `.prds/compounding-memory-review.md`
- `.prds/compounding-memory-company-second-brain-prd.md`

### Pipeline and architecture
- `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md`
- `.prds/compiled-memory-layer-engineering-prd.md`

### New packaging layer for planning kickoff
- `.prds/compounding-memory-visuals.md`
- `.prds/compounding-memory-messaging-brief.md`

## What a future planning agent should do next

Translate this package into a concrete implementation plan that:

1. preserves the normalized warehouse -> compiled layer separation
2. treats Aurora as primary for compiled pages
3. keeps the compiled layer rebuildable from canonical memory
4. starts with explicit v1 page types and no ontology expansion
5. includes unresolved mention handling as a first-class path, not a nice-to-have
6. keeps markdown export in scope, but downstream

## Suggested planning output

A good next planning pass should likely produce:

- phased implementation plan
- schema and migration sequence
- Lambda / job orchestration breakdown
- adapter and cursor work for Hindsight-backed reads
- compile, lint, and export task breakdown
- agent read-path and GraphQL delivery plan
- verification plan and feature-flag rollout sequence

## Short readiness note

The concept package is now strong enough to move from review into implementation planning. Messaging, architecture, and the core lifecycle model are aligned. The planning agent should treat the review docs as the why, the engineering PRD and pipeline deep dive as the how, and the new visuals plus messaging brief as the simplification layer for communication and kickoff.
