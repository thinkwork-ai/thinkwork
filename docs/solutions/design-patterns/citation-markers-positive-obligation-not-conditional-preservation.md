---
title: "Output-format duties must be positive obligations on the agent's own output, not conditional preservation"
category: design-patterns
module: agentcore-pi
date: 2026-08-13
problem_type: design_pattern
component: assistant
severity: medium
applies_when:
  - "Writing chat-agent system-prompt or instruction text that must control the format of the agent's own output (citations, markers, structured fragments)"
  - "An agent's reply must carry inline [n] citation markers sourced from a knowledge tool's answer"
  - "An output-format duty must hold across models of varying instruction-following strength (e.g. Claude Sonnet 4.6 vs Kimi K2.5)"
symptoms:
  - "Agent instructed to 'preserve inline [n] citation markers' emits zero markers, 0-for-N across two models"
  - "Knowledge-grounded replies render without clickable citation chips despite the tool answer containing [n] markers"
root_cause: logic_error
resolution_type: code_fix
tags:
  - prompt-design
  - instruction-following
  - citations
  - inline-citation-markers
  - output-format
  - chat-agent
  - model-dependence
  - knowledge-tools
related_components:
  - chat-agent-invoke
  - knowledge-tool
  - citation-renderer
---

# Output-format duties must be positive obligations on the agent's own output, not conditional preservation

## Context

The web UI renders inline `[n]` markers in an agent reply as clickable citation chips, linkified against the turn's citation map (PR #4278; renderer half is `knowledgeCitationsFromInvocations` in `apps/web/src/components/ai-elements/sources.tsx`, which extracts numbered citations from `brain_ask`-style knowledge-tool invocations to feed the inline `[n]` linkification). The chat agent's knowledge comes from a `brain_ask` MCP tool whose grounded answers carry `[n]` markers plus a citations array. PR #4279 tried to make agents keep those markers with a preservation-style instruction in the generated workspace tool-selection text: "When a knowledge tool's answer carries inline [n] citation markers, preserve those markers verbatim in your reply (do not strip or renumber them)." In live tests (session observation, 2026-08-13) this produced zero inline citations across both available chat models (Kimi K2.5 and Claude Sonnet 4.6): the agent summarizes the tool answer in fresh prose, so its own draft never contains markers — the "preserve if present" condition tests the wrong text and the duty never fires; models cited sources as prose instead ("According to the SOP…", bolded doc names). PR #4280 rewrote the instruction as a positive obligation on the agent's own reply, after which Claude Sonnet 4.6 emitted markers on each claim while Kimi K2.5 still emitted none.

## Guidance

State output-format duties as obligations on the agent's OWN output, never as conditional preservation of an upstream artifact.

- **The "condition tests the wrong text" principle**: an instruction of the form "if X appears in the tool output, preserve X in your reply" implicitly conditions on X already being present in the agent's draft. But the agent composes its reply as fresh prose synthesized from the tool answer — the markers were never in the draft, so there is nothing to "preserve" and the duty silently never triggers. The instruction must instead command the agent to *produce* the format: attach the marker to each claim it writes.
- **Before** (PR #4279, never fired):
  > "When a knowledge tool's answer carries inline [n] citation markers, preserve those markers verbatim in your reply (do not strip or renumber them); the UI renders them as clickable citations."
- **After** (PR #4280, shipped — `packages/api/src/lib/workspace-map-generator.ts:1279` on origin/main, the "Citation markers" bullet):
  > "- **Citation markers** — When your reply draws on a knowledge tool's answer, cite inline: put the tool's `[n]` marker (same number, verbatim) at the end of each claim that came from that source — the UI renders `[n]` as a clickable citation chip. Do not strip, renumber, or replace markers with prose like \"according to the SOP\"; a knowledge-grounded reply with no `[n]` markers is incomplete."
  Note the ingredients: a positive action verb ("cite inline: put the tool's [n] marker…"), a per-claim placement rule, the *reason* the format matters (UI renders chips), an explicit prohibition of the observed failure mode (prose citations), and a completeness criterion that makes the absence of markers a defect.
- **Escalation ladder**: prose instruction → capable model → mechanical enforcement. Compliance with output-format duties is model-dependent even when the wording is right (Sonnet 4.6 complied; Kimi K2.5 did not, 0-for-4 that day across both wordings). If a surface is format-critical, either pin it to a model known to comply or enforce the format mechanically (post-process/validate/inject markers), rather than relying on instructions alone.

## Why This Matters

This is a silent failure mode. The preservation-style instruction reads perfectly sensible in review, ships, and then never fires — no error, no log, nothing to debug. The downstream feature it exists to feed (citation chips in PR #4278's renderer) silently renders nothing, and the gap only shows up in live end-to-end testing. Worse, the failure looks like a model-quality problem ("the model won't cite") when it is actually a specification bug: the condition is evaluated against text that structurally cannot satisfy it.

## When to Apply

- Writing or reviewing any agent instruction about output format or structure: citations, markdown formatting, links, required sections, IDs, structured markers the UI parses.
- Reviewing existing instructions that say "preserve / keep / maintain / retain X if present" — ask what text the condition actually evaluates against; if the agent synthesizes its output rather than copying the upstream text, rewrite as a positive obligation.
- Deciding whether an instruction is sufficient for a format-critical surface: if a downstream renderer, parser, or pipeline depends on the format, plan for the escalation ladder (capable model or mechanical enforcement), not prose alone.

## Examples

**Before** (PR #4279): "When a knowledge tool's answer carries inline [n] citation markers, preserve those markers verbatim in your reply (do not strip or renumber them); the UI renders them as clickable citations." — Session observation 2026-08-13: zero inline citations from both Kimi K2.5 and Claude Sonnet 4.6; models cited as prose ("According to the SOP…", bolded document names).

**After** (PR #4280, current tree at `packages/api/src/lib/workspace-map-generator.ts:1279`): "When your reply draws on a knowledge tool's answer, cite inline: put the tool's `[n]` marker (same number, verbatim) at the end of each claim that came from that source — the UI renders `[n]` as a clickable citation chip. Do not strip, renumber, or replace markers with prose like 'according to the SOP'; a knowledge-grounded reply with no `[n]` markers is incomplete." — Session observation 2026-08-13: Claude Sonnet 4.6 emitted `[n]` on each claim and the UI chips rendered and clicked through to the source document; Kimi K2.5 still emitted none (0-for-4 that day across both wordings).

Related: renderer half in `apps/web/src/components/ai-elements/sources.tsx` (`knowledgeCitationsFromInvocations`, introduced in PR #4098); the brain_ask citation-extraction path that feeds it was added in PR #4278.

## Related

- [Inline citations shipped inert twice](../ui-bugs/inline-citations-shipped-inert-twice-2026-07-25.md) — the other half of the same feature failing silently: the renderer side (Streamdown sanitization ate the chips). Together, the two docs cover both ways [n] citations can appear dead.
- [Generator instruction changes do not propagate to agents on deploy](../workflow-issues/workspace-map-generator-deploys-dont-update-stored-agent-instructions.md) — the delivery layer beneath this lesson: even a correctly-worded instruction is inert until the stored agent baseline re-renders.
- [memory-retain model eval](../tooling-decisions/memory-retain-model-eval-2026-07-06.md) — prior head-to-head evidence that output compliance is model-dependent on this platform.
- [Recipe catalog LLM DSL validator feedback loop](../architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md) — prior art for the top rung of the escalation ladder: constrain and validate mechanically when LLM output format is load-bearing.
- [Verify unprompted agent selection with narrative prompts and one retry](../best-practices/verify-unprompted-agent-selection-with-narrative-prompts-and-one-retry.md) — how to test whether behavioral instructions are actually obeyed rather than assuming compliance.
