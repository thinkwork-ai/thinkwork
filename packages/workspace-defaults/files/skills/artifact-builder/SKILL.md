---
name: artifact-builder
description: Builds reusable ThinkWork Computer applets and interactive artifacts from research prompts. Use when the user asks to build, create, generate, or make a dashboard, applet, report, briefing, workspace, or other interactive surface.
---

# Artifact Builder

Use this skill when the user wants Computer to produce an interactive, reusable artifact. The expected output is a saved applet, not just a prose answer.

## Contract

1. Research with the available tools and thread context.
2. If live sources are missing or partial, keep going with the best available workspace, memory, context, web, or fixture data. Show missing or partial source status inside the applet.
3. Generate TSX using `@thinkwork/computer-stdlib` primitives and `@thinkwork/ui`.
4. Export a deterministic `refresh()` function whenever the result should be refreshable. Refresh must rerun saved source queries or deterministic transforms; it must not reinterpret the whole user request.
5. Call `save_app` before responding. Pass at least `name`, `files`, and `metadata`.
6. Include `threadId`, `prompt`, `agentVersion`, and `modelId` in metadata when available.
7. After `save_app` returns `ok`, answer concisely with what was created and the `/artifacts/{appId}` route.

## Applet Shape

Use `App.tsx` as the main file. Export one default React component. Prefer concise component-local data transforms over large abstractions. Do not use network calls, browser globals, dynamic imports, `eval`, or raw HTML injection.

Good applets include:

- Header with title, summary, and source badges.
- KPI strip for key totals.
- Charts or tables that make comparison easy.
- Evidence or source-status sections so users can inspect what drove the result.
- Empty, partial, and failed-source states.

## Missing Data

Missing data is not a reason to stop before creating the artifact. Create a runnable applet that makes source gaps explicit, then ask for source setup or approval as a follow-up when needed.

For the LastMile CRM pipeline risk prompt, build an applet that covers stale activity, stage exposure, and top risks. If live LastMile CRM records are unavailable, use the canonical LastMile-shaped structure and mark CRM/email/calendar/web source coverage honestly.
