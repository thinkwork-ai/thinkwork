---
title: "CopilotKit OSS package check for the AG-UI Computer spike"
date: 2026-05-10
category: architecture-patterns
tags:
  - computer
  - ag-ui
  - copilotkit
  - spike
---

# CopilotKit OSS package check for the AG-UI Computer spike

## Context

The Computer Thread + Canvas spike is testing AG-UI as an interaction protocol
without replacing ThinkWork persistence, auth, tenant scoping, memory,
observability, or audit. U6 checked whether CopilotKit OSS packages should be
installed directly into `apps/computer` during the spike.

## Package Check

Checked package metadata on 2026-05-10:

- `@copilotkit/react-core@1.57.1`: MIT, React 18/19 peer support, depends on
  `@ag-ui/core`, `@ag-ui/client`, CopilotKit runtime GraphQL client packages,
  A2UI renderer, web inspector, Radix, TanStack virtual, markdown, KaTeX,
  Streamdown, RxJS, and other UI/runtime helpers.
- `@copilotkit/react-ui@1.57.1`: MIT, depends on React Core plus Headless UI,
  markdown, and syntax-highlighting packages.
- `@ag-ui/client@0.0.53`: AG-UI client package with RxJS, protocol/encoder
  packages, zod, and JSON patch helpers.

CopilotKit's public product page frames the framework as open-source MIT core
with premium team features, while its AG-UI page describes CopilotKit as the
frontend layer that builds on AG-UI for production agentic apps. The AWS Strands
and AgentCore material is directionally aligned with ThinkWork's AWS-native
runtime path, but the React package footprint is larger than the current spike
needs.

## Decision

Do not install CopilotKit React packages in U6. Keep the spike AG-UI
protocol-first and add only an isolated local adapter that can be replaced by a
real CopilotKit integration later.

This preserves the important proof: ThinkWork-owned AG-UI events remain the
source of truth for transcript, Canvas components, diagnostics, and run state.
It also avoids coupling the experimental route to CopilotKit's runtime GraphQL
client, hosted/cloud configuration options, or default UI behavior before the
Thread + Canvas contract has won the broader foundation decision.

## Follow-Up

If U7 recommends pivoting to AG-UI, the first production plan should revisit
CopilotKit with a tighter question: can `@ag-ui/client` or a headless CopilotKit
primitive consume the ThinkWork/AgentCore stream without owning durable runtime
state? Install CopilotKit only when that answer is yes and the dependency diff
is reviewed in the PR.
