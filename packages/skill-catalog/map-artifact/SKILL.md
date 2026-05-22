---
name: map-artifact
display_name: "Map Artifact"
description: >
  Build a map-centered artifact that turns location or territory data into an inspectable spatial view.
license: Proprietary
category: map
version: "0.2.0"
author: thinkwork
icon: map
tags: [map, artifact, spatial]
execution: context
allowed-tools:
  - workspace search
  - connected data sources
  - artifact builder
metadata:
  author: thinkwork
  version: "0.2.0"
triggers:
  - "Build me a map of supplier risk."
  - "Create a territory map for these accounts."
  - "Show these locations on an interactive map artifact."
---

# Map Artifact

Use this skill when the user wants locations, territories, routes, regions, suppliers, accounts, or spatial risk represented as an inspectable map-centered artifact.

This skill composes with the `artifact-builder` skill — that skill owns the general artifact-build mechanics (`preview_app`, `save_app`, shadcn registry, TSX validation, component contracts). This skill adds the map-specific data shape (markers / polylines / geojson), the `MapView` primitive from `@thinkwork/computer-stdlib`, and the handling for ambiguous/approximate locations on top.

## How to use it

1. Follow the `artifact-builder` skill's contract for all artifact mechanics.
2. Use `references/discover.md` to scope location data fetching. Treat ambiguous, approximate, inferred, and missing locations visibly without overstating precision.
3. Use `references/produce.md` for the map structure — `MapView` for the primary map, markers/polylines/geojson per entity type, layers/filters/entity details, no embedded OSM iframes or hand-rolled `react-leaflet`.
4. Use `assets/map-artifact-data.schema.json` to shape the saved app's data structure.
