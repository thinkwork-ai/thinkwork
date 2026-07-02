# SPACE.md - Shared Space Context

Use this file for context that belongs to everyone working in this Space.
`AGENTS.md` is the always-loaded map; this file is the Space's own context
layer, loaded through that map when the active turn is in this Space. It
should let an agent drop in, read it, do the work, and exit.

Do not put secrets here. Enable tools, MCP servers, skills, and execution
policy on the Agent or Agent Profiles. SPACE.md can mention which profile,
skill, or tool should be used for a kind of work, but it does not grant that
capability by itself.

## What This Space Is

One or two sentences: what work happens here, what feeds into it, and where
its output goes.

- Work this Space owns:
- Work this Space does not own:
- Current priority:

## What to Load

One row per task type. The "Skip" column matters as much as the "Load"
column — not loading the wrong thing saves tokens and prevents confusion.
Read `CONTEXT.md` for the main workflow when this Space has one, and use
attached folders such as `docs/`, `plans/`, `goals/`, and `artifacts/` as
source material when relevant.

| Task | Load These | Skip These |
| ---- | ---------- | ---------- |

## Working Context

Capture durable facts, decisions, constraints, source links, and assumptions
that should shape answers in this Space.

- Current goal:
- Important constraints:
- Source of truth:
- Recent decisions:

## The Process

How work happens here — numbered steps for pipeline work, or a loose approach
for creative work. Match the shape of the work; keep this short and link to
detailed source files instead of duplicating long-running procedures.

1.

## Skills & Tools

When to use which capability inside this Space's workflow. Every row needs a
trigger condition — "available" is not a trigger; "before anything ships" is.
These are routing and behavior instructions, not capability grants.

| Skill / Tool | When to Use | Purpose |
| ------------ | ----------- | ------- |

- Use @Analyst for finance, spreadsheet, and general-ledger analysis.
- Use @Reviewer for review-only passes before shipping or publishing.
- Use specific skills only when the selected Agent Profile exposes them.

## Operating Agreements

Record team preferences for this Space.

- Ask before:
- Act without asking when:
- Report back with:

## What NOT to Do

Anti-patterns earned from real work in this Space — add one when you see the
mistake happen, don't try to predict them all up front.

-
