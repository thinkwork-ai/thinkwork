---
title: "docs: Add Spaces Agentic OS user guide"
type: docs
status: completed
date: 2026-05-27
origin: docs/brainstorms/2026-05-27-spaces-agentic-os-user-guide-requirements.md
---

# docs: Add Spaces Agentic OS user guide

## Overview

Add a practical, human-readable Spaces guide that teaches operators and end users how to use ThinkWork's Agentic OS model:

```text
Agent acts in a Space on behalf of a User toward a Goal.
```

The guide should complement the existing concept and application reference pages. Concept pages explain what Spaces, Threads, Goals, and folder-native agents are. Admin pages explain the operator UI surfaces. The new guide should teach the working practice: how to build a useful Space, how users should work inside it, how repeated work becomes Goal-oriented workflow, and how to get better results.

---

## Problem Frame

The current documentation is structurally correct but not yet sufficient for a client-facing Spaces demo. The product now includes Space detail pages, thread-bound Goal panels, review actions, Files mode backed by the shared workspace editor, Space Workspace inspection, Customer Onboarding workflow patterns, and a broader Agentic OS doctrine. Readers need one guided path through those concepts without needing an engineer to narrate the system live.

The requirements doc calls for practical documentation first: explain what to do, why it works, and how to avoid common mistakes. The guide must document current shipped behavior while using clear "North Star" callouts for emerging doctrine such as export-readiness and maturity levels.

---

## Requirements Trace

- R1. Create a full Spaces user guide rather than only expanding concept reference pages.
- R2. Optimize the guide around the journey: operator builds or improves a Space, then end users work inside it.
- R3. Document shipped behavior as the main path; label North Star or emerging behavior clearly.
- R4. Avoid contradictory Spaces explanations by cross-linking and repositioning existing pages.
- R5. Use plain sections, examples, checklists, and "when to use this" guidance.
- R6. Teach the canonical model: Agent acts in a Space on behalf of a User toward a Goal.
- R7. Explain Agents, Spaces, Users, Threads, Goals, workspace files, and Company Brain in everyday language.
- R8. Preserve the Spaces vs. folder-specialists distinction.
- R9. Teach the maturity ladder from Space chat to Goal workflow to Company Brain learning.
- R10. Teach Delegate vs Collaborate as a top-level responsibility model.
- R11. Show operators when a Space is warranted.
- R12. Show what belongs in Space workspace files.
- R13. Explain Goal-oriented workflows with Customer Onboarding as the reference example.
- R14. Explain folder-native, portable markdown as operating substrate without promising export UI.
- R15. Explain structured-vs-narrative state: Aurora for indexed workflow state, markdown for agent-readable context.
- R16. Show end users how to pick the right Space before starting work.
- R17. Explain Thread vs Goal in workflow terms.
- R18. Explain the right-side info panel in human terms.
- R19. Explain Files mode: thread Goal Folder and Space Workspace inspection.
- R20. Explain Confirm and Changes review actions.
- R21. Include web and desktop expectations where relevant.
- R22. Include best-result advice for users.
- R23. Include best-result advice for operators.
- R24. Include common failure modes and fixes.
- R25. Include ad hoc task guidance without making ThinkWork sound like a generic task manager.
- R26. Include good and bad prompt/message examples.
- R27. Keep the docs detailed and human-readable.
- R28. Make each conceptual section answer "why this exists" and "what should I do with it?"
- R29. Use consistent Starlight callouts for current behavior vs. North Star.
- R30. Cross-link Spaces, Threads, Goals, Folder Is the Agent, Desktop, Mobile Threads, Admin Spaces, Knowledge/Memory, Automations, and the Customer Onboarding runbook.

**Origin actors:** A1 tenant operator, A2 Space author, A3 end user, A4 Goal owner/reviewer, A5 coordinator agent, A6 support/operator teammate, A7 product/engineering planner.

**Origin flows:** F1 operator learns the model and builds a useful Space, F2 operator turns repeated work into Goal-oriented workflow, F3 end user works inside a Space, F4 reader improves results through practical habits.

**Origin acceptance examples:** AE1 operator can build Customer Onboarding Space context, AE2 new reader can explain Agent/Space/User/Goal, AE3 reviewer understands the info panel and human review, AE4 Files mode distinction is clear, AE5 poor-result troubleshooting is actionable.

---

## Scope Boundaries

- Do not change product behavior in this docs pass.
- Do not promise export UI, local runner support, automatic template improvement, or full project-management behavior as shipped.
- Do not turn the guide into an API reference.
- Do not document database schema, resolver internals, or S3 key conventions beyond the high-level source-of-truth explanation required for portability.
- Do not make Customer Onboarding sound like the only valid Space pattern.
- Do not hide current limits. Use clearly-labeled "Current behavior" and "North Star" asides where needed.

---

## Context & Research

### Existing Docs

- `docs/src/content/docs/concepts/spaces.mdx` already defines Spaces as contextual workrooms and links to the component reference pages.
- `docs/src/content/docs/concepts/goals.mdx` already contains the strongest current statement of Goals, Delegate vs Collaborate, the maturity ladder, source-of-truth split, Goal folders, and Customer Onboarding.
- `docs/src/content/docs/concepts/spaces/spaces-and-threads.mdx` defines the Thread/Space boundary that the guide should reuse.
- `docs/src/content/docs/concepts/agents/folder-is-the-agent.mdx` explains folder-native architecture and already relates Agent folders, Space source folders, and Thread Goal folders.
- `docs/src/content/docs/applications/admin/spaces.mdx` and `docs/src/content/docs/applications/admin/spaces/*` cover operator UI reference pages: Workspace, KBs, Triggers, Settings, Members.
- `docs/src/content/docs/applications/desktop/index.mdx` explains that Desktop packages the shared Spaces app and receives updates through desktop releases.
- `docs/src/content/docs/applications/mobile/threads-and-chat.mdx` explains mobile Threads, Space picker behavior, and human-in-the-loop cards.
- `docs/runbooks/customer-onboarding-space-runbook.md` is an operator runbook for the demo seed path and native checklist proof.

### Product Labels Verified During Planning

- Space detail header uses breadcrumb-like labels `Spaces > {Space Name}` through the shared page header.
- Space detail exposes a Tabler `IconFiles` action with title/aria labels "Open Space workspace files" and "Close Space workspace files".
- Space detail's normal view shows "Recent threads" and either "Start onboarding" for Customer Onboarding or "New chat" for ordinary Spaces.
- Thread detail exposes a Tabler `IconFiles` action for thread Files mode.
- Thread Files mode uses `ThreadWorkspaceView` and defaults the shared `WorkspaceFileEditor` to `GOAL.md`.
- Space Files mode uses the same `WorkspaceFileEditor` and defaults to `CONTEXT.md`.
- The right-side Goal panel labels include `Goal`, `Review`, `Progress`, `Confirm`, and `Changes`; the change dialog asks the user to describe what must change before the Goal can be closed.

### Prior Planning Artifacts

- `docs/brainstorms/2026-05-27-agentic-os-folder-native-goals-requirements.md`
- `docs/plans/2026-05-27-003-feat-folder-native-goals-plan.md`
- `docs/brainstorms/2026-05-27-thread-goal-folder-file-editor-requirements.md`
- `docs/plans/2026-05-27-005-feat-thread-goal-folder-editor-plan.md`
- `docs/brainstorms/2026-05-26-spaces-docs-expansion-requirements.md`

### Editorial Standards

- `docs/STYLE.md` requires a plain hook paragraph, honest limits, real cross-links, and a clear separation between narrative explanation and "Under the hood" details.
- The guide should use Starlight `<Aside>` for `Current behavior` and `North Star` notes rather than inventing custom styling.

---

## Key Editorial Decisions

- Add a new guide section under `guides/spaces/` instead of forcing end-user education into concept reference pages. The guide can be linked from Configure > Authoring Guides and from the existing Spaces/Goals/Admin pages.
- Use four guide pages rather than one giant page:
  - overview/model and reading path,
  - operator build guide,
  - end-user work guide,
  - Goals/files/best-practices guide.
- Keep concept pages authoritative for definitions; keep the guide authoritative for how to work.
- Use Customer Onboarding as the running example, but include enough generic language for Finance, Support, Project, Inbox, and Customer Spaces.
- Treat the workspace editor as current shipped behavior for inspecting Space Workspace and thread Goal Folder files. Keep the source-of-truth explanation high level.

---

## Open Questions

### Resolved During Planning

- **One page or section?** Create a small guide section. The topic has multiple audiences and flows, and a single page would be too dense for demo follow-up reading.
- **Where in navigation?** Add it under Configure > Authoring Guides as "Spaces", then cross-link from Concepts and Applications pages. This avoids duplicating the component reference section while still giving operators a clear path.
- **Callout treatment?** Use Starlight `<Aside type="note">` for current-behavior notes and `<Aside type="tip">` for North Star doctrine or best-practice framing. Use explicit headings in the aside text, such as "Current behavior:" and "North Star:".
- **Prompt example count?** Include a compact good/bad example table in v1, with enough examples to demonstrate the pattern without becoming a prompt cookbook.

### Deferred to Implementation

- Exact page filenames may shift if Starlight route generation or sidebar ergonomics favor flatter guide paths.
- Some current UI contains compact Goal file summaries as well as full Files mode. The guide should prioritize the main Files mode and mention summaries only if the final current docs need to explain what users see.

---

## Output Structure

Expected docs shape:

```text
docs/src/content/docs/guides/spaces/
  index.mdx
  build-a-space.mdx
  work-in-a-space.mdx
  goals-and-files.mdx
  best-practices.mdx
```

Sidebar addition:

```text
Configure
  Authoring Guides
    Spaces
      Overview
      Build a Space
      Work in a Space
      Goals and Files
      Best Practices
```

---

## Implementation Units

- U1. **Add Spaces Guide Navigation and Overview**

**Goal:** Create the guide entry point and wire it into the docs sidebar.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R29, R30

**Dependencies:** None

**Files:**
- Create: `docs/src/content/docs/guides/spaces/index.mdx`
- Modify: `docs/astro.config.mjs`

**Approach:**
- Add a hub-style overview page following `docs/STYLE.md`.
- Open with the canonical Agent/Space/User/Goal model.
- Explain the reader path: first build the Space, then work in it, then promote repeated work into Goals, then refine best practices.
- Include a simple responsibility table for Agents, Spaces, Users, Threads, Goals, workspace files, and Company Brain.
- Add the new guide group under Configure > Authoring Guides in `docs/astro.config.mjs`.

**Test scenarios:**
- The guide overview appears in the Starlight sidebar.
- The overview links to every child page with correct site paths.
- The overview does not duplicate the full concept reference text from `concepts/spaces.mdx`.

**Verification:**
- `pnpm --filter @thinkwork/docs build`

---

- U2. **Write Operator Guide for Building Spaces**

**Goal:** Teach operators and Space authors how to decide when to create a Space and how to write useful Space context.

**Requirements:** R2, R5, R7, R8, R11, R12, R13, R14, R15, R23, R24, R27, R28, R30

**Dependencies:** U1

**Files:**
- Create: `docs/src/content/docs/guides/spaces/build-a-space.mdx`
- Modify: `docs/src/content/docs/applications/admin/spaces.mdx`
- Modify: `docs/src/content/docs/applications/admin/spaces/workspace.mdx`

**Approach:**
- Explain when a Space is warranted: team, customer, project, workflow, inbox, channel, or context boundary.
- Provide a "what belongs in Space files" checklist: operating context, source links, intake questions, examples, local rules, workflow templates, and known exclusions.
- Explain Spaces vs folder specialists without re-litigating agent architecture.
- Introduce Customer Onboarding as the reference workflow without treating it as the only pattern.
- Cross-link Admin Space Workspace docs so operators can move from the guide to UI reference.

**Test scenarios:**
- A reader can decide whether to create a Space or use an existing Space.
- The page tells operators what to put in `CONTEXT.md` and related workspace files without promising export UI.
- Existing Admin Spaces pages link to the practical guide without losing their reference-page focus.

**Verification:**
- `pnpm --filter @thinkwork/docs build`

---

- U3. **Write End-User Guide for Working in Spaces**

**Goal:** Teach end users how to choose a Space, start work, collaborate with the agent, read the info panel, inspect Files mode, and review completion.

**Requirements:** R10, R16, R17, R18, R19, R20, R21, R22, R24, R25, R26, R27, R28, R30

**Dependencies:** U1

**Files:**
- Create: `docs/src/content/docs/guides/spaces/work-in-a-space.mdx`
- Modify: `docs/src/content/docs/applications/desktop/index.mdx`
- Modify: `docs/src/content/docs/applications/mobile/threads-and-chat.mdx`

**Approach:**
- Walk through choosing the right Space, starting a normal chat, and starting a Space-specific workflow such as Customer Onboarding.
- Explain Threads as collaboration records and Goals as structured outcome contracts.
- Explain the right-side info panel in user language: outcome, owner, mode, review, progress, task status, and metadata.
- Explain the Files icon in thread detail as the way to inspect the thread's Goal Folder, and the Files icon on Space detail as the way to inspect the Space Workspace.
- Explain Confirm and Changes review actions in plain language.
- Add desktop and mobile expectations: Desktop uses the shared Spaces app, while mobile is mainly a thread/chat participation surface.

**Test scenarios:**
- A new end user can answer "which Space should I use?" and "what does this panel mean?"
- The Files mode explanation distinguishes thread-local Goal Folder from parent Space Workspace.
- Review action copy matches the current UI labels `Confirm` and `Changes`.

**Verification:**
- `pnpm --filter @thinkwork/docs build`

---

- U4. **Write Goals, Files, and Best-Practices Guide**

**Goal:** Give readers practical rules for Goal-oriented workflows, folder-native files, source-of-truth split, ad hoc tasks, and getting better results.

**Requirements:** R6, R9, R10, R13, R14, R15, R17, R19, R20, R22, R23, R24, R25, R26, R27, R28, R29, R30

**Dependencies:** U1

**Files:**
- Create: `docs/src/content/docs/guides/spaces/goals-and-files.mdx`
- Create: `docs/src/content/docs/guides/spaces/best-practices.mdx`
- Modify: `docs/src/content/docs/concepts/goals.mdx`
- Modify: `docs/src/content/docs/concepts/spaces.mdx`
- Modify: `docs/src/content/docs/concepts/spaces/spaces-and-threads.mdx`
- Modify: `docs/src/content/docs/concepts/agents/folder-is-the-agent.mdx`

**Approach:**
- Reuse the Goals concept page as the authoritative definition and write a practical companion page for operators/users.
- Explain Goal contract fields, Delegate vs Collaborate, maturity ladder, Goal folders, and structured-vs-narrative state.
- Use a concise table for `GOAL.md`, `PROGRESS.md`, `DECISIONS.md`, `ARTIFACTS.md`, and `HANDOFFS.md`.
- Add best-practice and anti-pattern examples:
  - right Space vs wrong Space,
  - source facts vs vague request,
  - outcome-first request vs activity-only request,
  - Delegate vs Collaborate expectation,
  - ad hoc task captured in Thread but tied back to Goal progress where possible.
- Add common failure modes and fixes: wrong Space, missing source data, ambiguous owner, unclear completion criteria, stale workspace context, and expecting workflow Spaces to behave like generic chat.
- Cross-link the guide from existing concept pages as "how to use this in practice."

**Test scenarios:**
- A support teammate can point a confused user to the best-practices page for poor result diagnosis.
- A reader understands files as agent-readable operating context, not decorative exports.
- Existing concept pages continue to define the model while the guide handles practical usage.

**Verification:**
- `pnpm --filter @thinkwork/docs build`

---

- U5. **Build, Link, and Editorial Verification**

**Goal:** Ensure the docs compile, links resolve, and the new material does not contradict existing Spaces/Goals pages.

**Requirements:** R3, R4, R27, R28, R29, R30

**Dependencies:** U1, U2, U3, U4

**Files:**
- Modify as needed based on build/link findings in the files above.

**Approach:**
- Run the docs build.
- Search for stale or contradictory text such as "Goal Files" if the final guide explains Files mode differently.
- Search for broken or missing guide links.
- Keep "Under the hood" sections minimal or absent on user-guide pages unless a high-level technical pointer is genuinely useful.

**Test scenarios:**
- `pnpm --filter @thinkwork/docs build` succeeds.
- `rg "/guides/spaces" docs/src/content/docs` shows cross-links from relevant concept/application pages.
- `rg "North Star|Current behavior" docs/src/content/docs/guides/spaces` shows callouts are labeled consistently.

**Verification:**
- `pnpm --filter @thinkwork/docs build`
- `rg "/guides/spaces" docs/src/content/docs`
- `rg "Current behavior|North Star" docs/src/content/docs/guides/spaces`

---

## Final Verification

- `pnpm --filter @thinkwork/docs build`
- Optional local preview if the build passes and browser verification is needed:
  - `pnpm --filter @thinkwork/docs dev -- --host 127.0.0.1 --port 4321`
