---
title: "AI Elements iframe Canvas foundation decision"
date: 2026-05-10
category: architecture-patterns
tags:
  - computer
  - ai-elements
  - canvas
  - ag-ui
  - decision
---

# AI Elements Iframe Canvas Foundation Decision

## Decision

Continue the raw AI Elements iframe/app artifact path as the Computer Thread +
Canvas foundation. Archive the CopilotKit/AG-UI spike as reference material, but
remove the merged AG-UI implementation from `main`.

The deciding requirement is generic generated UI. Computer needs to generate
whatever the user asked for, from a compact dashboard to a full embedded
application. A registered-component GenUI model is useful for controlled
surfaces, but it is too narrow to be the primary foundation while we still need
maximum layout, state, interaction, and app-runtime flexibility.

## Why

- The iframe/app artifact path can host arbitrary generated applications behind
  ThinkWork-owned sandboxing, persistence, auth, audit, and observability.
- AI Elements can still provide thread/message composition while the generated
  app surface remains owned by ThinkWork's artifact runtime.
- AG-UI and CopilotKit remain useful references for typed tool events, HITL,
  shared state, and future protocol design, but adopting them now would force
  the Canvas path toward registered React components before the product shape is
  proven.
- A2UI-style generated UI is comparable for bounded, schema-driven UI, but it
  does not replace a full embedded application substrate without recreating the
  same sandbox and artifact lifecycle elsewhere.

## Implications

- No production `/agui/threads/$id` route in `main`.
- No `Open Canvas` action to the AG-UI spike route from the Thread header.
- No AG-UI event publisher/helper in `packages/api`.
- Keep the CopilotKit/AG-UI brainstorm, plan, status, and verdict docs for
  future research.
- Revisit AG-UI only after the iframe artifact runtime has a stable contract and
  there is a concrete reason to add a typed interaction protocol around it.

## Near-Term Direction

- Harden the raw AI Elements Thread path and iframe Canvas/app artifact runtime.
- Treat generated dashboards as real saved app artifacts, not ephemeral
  registered component renders.
- Keep generated code execution inside the existing artifact sandbox boundary.
- Add evaluation prompts that require non-toy dashboards and embedded app
  behavior, so the foundation is tested against the flexibility requirement that
  drove this decision.
