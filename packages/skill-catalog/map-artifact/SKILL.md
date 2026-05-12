---
name: map-artifact
display_name: "Map Artifact"
description: >
  Build a map-centered artifact that turns location or territory data into an inspectable spatial view.
license: Proprietary
category: map
version: "0.1.0"
author: thinkwork
icon: map
tags: [computer-runbook, map, artifact, spatial]
execution: context
allowed-tools:
  - workspace search
  - connected data sources
  - artifact builder
metadata:
  author: thinkwork
  version: "0.1.0"
  thinkwork_kind: computer-runbook
  thinkwork_runbook_contract: references/thinkwork-runbook.json
triggers:
  - "Build me a map of supplier risk."
  - "Create a territory map for these accounts."
  - "Show these locations on an interactive map artifact."
---

# Map Artifact

Use this skill when the user wants locations, territories, routes, regions, suppliers, accounts, or spatial risk represented as an inspectable map-centered artifact.

Start by reading `references/thinkwork-runbook.json` for routing, confirmation, phase, output, and asset contracts. Then load only the phase guidance needed for the current phase.

Follow the phase order unless the active run snapshot tells you otherwise: discover map data, analyze spatial patterns, produce the map artifact, then validate mapped evidence. Treat ambiguous, approximate, inferred, and missing locations visibly without overstating precision.

When producing the artifact, use `assets/map-artifact-data.schema.json` and the produce-phase guidance to shape the saved app.
