# ThinkWork Documentation Style Guide

This is the editorial standard for the ThinkWork documentation site (`docs/` — the Starlight + Astro build that serves `docs.thinkwork.ai`). It is not published to the site. It exists so every page we write — and every page a future contributor writes — measures against the same rubric.

If you're about to write or edit a page, read this first. It will save you a round of review.

## The one rule

**A human should be able to read the top of any page and come away understanding what the component is, why it exists, and how it fits the rest of the system — without ever jumping to a code sample.**

Everything else in this guide is the consequence of that rule.

## Voice and tone

Write like a confident, honest engineer explaining the system to a colleague who is sharp but new.

- **Confident.** State what the system is and what it does. Avoid hedging qualifiers ("this might", "you could perhaps"). If we're not sure it's true, it shouldn't be in the doc.
- **Honest.** If a feature has a known limit, say so. If a page documents a feature that's half-shipped, call that out — prefer a "Known limits" section to a false sense of completeness.
- **Plain.** No marketing copy. No "seamlessly." No "harness your agents with unprecedented ease." No "journey." The doc is a reference, not a brochure.
- **Direct.** Second person when addressing the reader ("you can…"), but only where it earns its place. Most sentences are third-person ("a thread is…", "the worker reads…").

Tone checks that usually catch slop:

- If a sentence starts with "In today's fast-paced world of AI," delete it.
- If you see "leverage" as a verb, replace with "use."
- If the opening paragraph could describe any product (not specifically ThinkWork), it's too generic — rewrite.
- If you're using three adjectives where one will do ("powerful, flexible, reliable"), cut two.

## Page structure

Every substantive page follows this shape. Some sections are optional — hubs vary — but the order is fixed.

```
page.mdx
├── frontmatter (title, description — both real)
│
├── Hook paragraph (1–2 sentences)
│       "A thread is the fundamental unit of work in ThinkWork..."
│
├── Plain-language body
│   ├── Why this exists / What it does for you
│   ├── Walking tour of the concept (prose + targeted visuals)
│   └── Worked example (optional, when it earns its place)
│
├── Honesty sections (when applicable)
│   ├── Known limits
│   └── What can go wrong
│
├── Related pages (cross-links)
│
└── ## Under the hood (when applicable)
    ├── Code paths (repo-relative)
    ├── Config / env vars
    ├── Schemas / SQL
    └── Contracts
```

### The hook paragraph

The first 1–2 sentences are load-bearing. They are what the reader's eye lands on and what Google surfaces as the meta description fallback. The hook must:

- Name the thing
- Say what it is, in one breath
- Give the reader a reason to keep reading

Compare:

> **Thin:** This page describes compounding memory.

> **Strong:** Compounding memory is the pipeline that turns an agent's raw memory records into a navigable wiki of entity and topic pages. This doc is a walking tour: first in plain language, then in technical detail for anyone who needs to modify or debug it.

### Hub pages

A hub page is a section root — the `.mdx` at the top of a sidebar group. Examples: `concepts/threads.mdx`, `applications/admin/index.mdx`, `concepts/knowledge.mdx`.

Hub pages have their own shape:

1. **Hook paragraph** — same rules.
2. **2–3 paragraphs of real prose** explaining what the component is, why it's in ThinkWork, how it relates to neighboring components.
3. **Optional diagram or table** if one helps.
4. `<CardGrid>` of children with one-sentence descriptions.
5. **"Read this section" ordering recommendation** if there's a natural reading order.

A hub page that is just a hook + a `<CardGrid>` is a failure. The reader came there expecting to build a mental model before drilling in, and we sent them straight to the menu.

### The "Under the hood" section

Technical specifications — code paths, SQL, schemas, env vars, handler file locations — go under `## Under the hood` at the end of the page. Not in the middle. Not sprinkled through. A single clearly-labeled section near the bottom.

Why: readers arrive with different goals. A product-curious reader wants the narrative and nothing else. A developer debugging the system wants the code path. Separating the two serves both. It also makes stale technical details easy to find and replace without touching narrative prose.

**What belongs under the hood:**

- Repo-relative file paths (`packages/api/src/lib/wiki/compiler.ts`)
- SQL, migrations, env var names, feature flags
- GraphQL schema snippets
- Handler contracts (request/response shapes)
- Model IDs, defaults, caps, timeouts
- Prompt contracts

**What does not belong under the hood:**

- Prose about *why* a design exists — that stays in the main body.
- Honest caveats ("this is slow when N > 10,000") — those belong in "Known limits."

## When to use code samples

Code samples are welcome when they illustrate a concept the prose can't convey as efficiently. They are not welcome when they replace prose.

**Use a code sample when:**

- You're showing the shape of a contract (a GraphQL mutation, a webhook payload) and prose would be clumsier than JSON.
- You're walking a worked example and the code *is* the example.
- You're documenting a reference surface (CLI output, SQL migration) that's the reason the reader is on the page.

**Don't use a code sample when:**

- You haven't explained the concept yet. Prose before mutation.
- It's longer than 40 lines and there's no narrative between blocks.
- It's schema reference that belongs on an API page, not a concept page.
- It's there because you couldn't think of what to write next.

**Rule of thumb:** if you deleted the code block, could a reader still understand the concept from the surrounding prose? If yes, the code block is an aid. If no, you're leaning on the code to carry the explanation — rewrite with prose first, sample second.

## Starlight components

The docs site uses `@astrojs/starlight/components`. Use them consistently.

### `<Aside>`

Four types, each with a specific use:

- `type="note"` — a useful aside that isn't a warning. Use sparingly; too many and the page feels cluttered.
- `type="tip"` — a practical recommendation the reader can act on.
- `type="caution"` — something that can go wrong if misused, but won't destroy data.
- `type="danger"` — data loss, security breach, or irreversible destruction.

Asides should be short (2–4 sentences). If an aside is growing paragraphs, promote it to a "Known limits" or "What can go wrong" section.

### `<Steps>`

For sequences where order matters and each step is visibly distinct. The deploy walkthrough and the install walkthrough are good fits. A conceptual list is not — use a normal ordered list.

### `<Tabs>` / `<TabItem>`

For showing the same operation in multiple forms (GraphQL vs. curl vs. SDK). Don't use tabs to hide content — if a reader needs to click to discover it, they'll miss it.

### `<Card>` / `<CardGrid>`

Hub pages only. A `<CardGrid>` on a leaf page usually means the leaf has become a hub in disguise — split it.

## Diagrams

A diagram earns its place when it shows something prose can't. Most pages don't need one.

**Good candidates:**

- Multi-surface flows (user action → API → Lambda → external service → back) — a sequence diagram.
- State lifecycles (BACKLOG → TODO → IN_PROGRESS → DONE) — a state diagram.
- Layered architecture (foundation / data / app tiers) — a block diagram.
- Data model relationships — an ERD.

**Bad candidates:**

- A two-node diagram of "Client → Server." Just write it.
- A diagram that restates the prose — cut one or the other.
- An ASCII diagram that's less clear than the paragraph above it.

When in doubt, try the paragraph first. If a reviewer says "I had to re-read that twice," a diagram might help. If they say "I got it on the first pass," no diagram needed.

Tables are often a better choice than diagrams. State transitions, status codes, env vars, and resource lists all work well as tables. Use a diagram only when the relationships are graph-shaped, not tabular.

## Naming

We use these names consistently. Not "conversations," not "workflows," not "the memory system" — always the canonical name:

| Canonical name | Not |
|---|---|
| Threads | conversations, chats, sessions |
| Agents | bots, assistants, AI agents |
| Memory | context, knowledge base (KB is a specific thing, not the umbrella) |
| Connectors | integrations (integrations is a *kind of* connector) |
| Automations | workflows, jobs, schedules |
| Control | governance, safety, guardrails-only |
| Compounding memory | the wiki, the memory wiki (those are ok in prose but not as section headings) |
| Managed agents | AgentCore agents (AgentCore is where they run — managed is what they are in ThinkWork) |
| Connected agents | self-hosted agents, external agents |

For the six top-level concepts, capitalize when referring to them as named system components ("Threads are the record of work"). Lowercase when using the word generically ("open a new thread").

## Cross-links

- Prefer relative site paths: `/concepts/threads/` over `../concepts/threads.mdx`.
- Prefer linking to the thing over describing the path: "see [Threads](/concepts/threads/)" over "see concepts/threads.mdx."
- Avoid backticked file paths in prose except in "Under the hood" sections, where they're showing real code paths.
- Every substantive page ends with a "Related pages" section linking to 2–5 adjacent pages.

## Frontmatter

Every page has real frontmatter. Stub frontmatter is unacceptable.

```yaml
---
title: Compounding Memory: Pipeline
description: How raw memories become a navigable wiki — step by step, in plain language, then in technical detail.
---
```

- `title`: a noun or noun phrase. Not a sentence. Not a command.
- `description`: a single sentence under 160 characters (OG preview limit). It should stand alone — someone seeing just the title + description in search should know whether to click.

## Honesty sections

### "Known limits"

When a feature is genuinely limited (not-yet-implemented, platform-specific, edge-case-sensitive), document it. A "Known limits" section at the end of a page is the right place.

Example pattern:

```markdown
## Known limits

- **Attachment upload is stubbed.** The upload handler throws "not yet implemented." Tracked as a TODO in the source.
- **Activity feed is stitched client-side.** A dedicated activity-feed query is on the roadmap.
- **No bulk actions.** The list does not support multi-select.
```

### "What can go wrong"

For runtime-sensitive features (compile pipelines, deploy flows, migrations), a "What can go wrong" section catalogs failure modes and how the system responds. Operators thank you for this; it saves them from reading source.

Example pattern:

```markdown
## What can go wrong

**Bedrock throttling.** ThrottlingException comes back when the quota is exhausted. Cursor stays put, next invoke retries clean.

**JSON truncation.** Output exceeding maxTokens comes back malformed. Clamped per-model via MODEL_MAX_OUTPUT_TOKENS.
```

## What to avoid

- **"Welcome to"** anywhere on the site. Welcome sections are filler.
- **"In this guide, we will..."** Just do the thing.
- **"Without further ado..."** Never.
- **"Under the hood!" with the exclamation mark** — tonally wrong. `## Under the hood` as a heading is fine.
- **Emoji in prose.** The site uses Starlight's icon set via component props; don't sprinkle emoji into sentences.
- **Breathless code dumps.** If a page is 80% code blocks, it's not a doc page — it's reference material that belongs on a dedicated reference page.
- **Promises about the future.** "We plan to..." dates badly. If something is on the roadmap, link to the roadmap page.

## A before/after example

**Before** — the `concepts/threads.mdx` as it stood:

```markdown
---
title: Threads
description: The universal work container in ThinkWork.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

A thread is the fundamental unit of work in ThinkWork. Whether work starts
from a chat, automation, email, or connector event, it lands in the same
thread model.

## What threads give you

Threads provide the shared container for:
- message history
- status tracking
- channel identity
- metadata from the source system
- auditability and replayability

<CardGrid>
  <Card title="Lifecycle and Types" icon="list-tree">
    Statuses, prefixes, channels.
  </Card>
  <Card title="Routing and Metadata" icon="seti:settings">
    Channel-specific metadata and routing context.
  </Card>
</CardGrid>

## Read this section

- [Lifecycle and Types](/concepts/threads/lifecycle-and-types/)
- [Routing and Metadata](/concepts/threads/routing-and-metadata/)
```

That's 45 lines. It has a hook. It has a card grid. It has a bullet list. What it does not have is the thing that makes threads interesting: *why* ThinkWork chose one universal container instead of three separate systems, what the channel prefix encodes, why auditability is non-negotiable, and how the same thread surfaces in the admin web app, the mobile app, and the connector webhooks. A reader comes away with a label, not a mental model.

**After** — what the same page should feel like:

```markdown
---
title: Threads
description: The universal work container in ThinkWork. Every conversation, automation run, and connector event lands in the same durable record with history, status, and channel context.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

A thread is the fundamental unit of work in ThinkWork. A chat message from
a user, a Slack event from a connector, a scheduled automation turn, an
inbound email — every one of them lands in a thread. Same schema, same
lifecycle, same audit trail, same API.

That choice is load-bearing. Most agent systems split "chat" from
"workflows" from "integrations" into three code paths, three sets of UI
affordances, and three sets of state machines. ThinkWork deliberately
doesn't. There is one universal container, and it carries enough metadata
(channel, prefix, routing context) to specialize behavior per source without
splitting the container itself.

## Why threads exist

The alternative — bespoke records for chat sessions, workflow runs, and
inbound webhooks — makes every cross-cutting concern (audit, budget,
handoff, retry) a special case. ThinkWork picks the other tradeoff: every
piece of work is a thread, and every code path in the system treats threads
as the canonical state.

That pays off when:

- **Handoff.** A Slack thread needs to escalate to a human. The admin app
  already has a thread detail view — no new surface to build.
- **Audit.** A compliance question lands for any agent turn. The thread
  has the full record — messages, tool calls, memory reads, guardrail
  decisions, cost — regardless of whether it started from chat, cron, or
  webhook.
- **Composition.** Automations can spawn child threads; connectors can
  reply into existing threads; agents can pin context from a previous
  thread into a new one. All uniformly, because it's all the same thing.

## The channel prefix

Every thread's id starts with a prefix that encodes its origin: `CHAT-`,
`AUTO-`, `SLACK-`, `GITHUB-`, `TASK-`, `EMAIL-`. The prefix isn't
cosmetic — it's how routing, rendering, and UI affordances specialize per
origin without branching the core lifecycle.

...

## Thread lifecycle

(narrative continues — how a thread moves through BACKLOG → TODO →
IN_PROGRESS → DONE, what drives transitions, what "running" means)

## Where threads show up in the product

(how the admin app, mobile app, and CLI each surface threads)

## Known limits

(attachment upload is stubbed; bulk actions not supported; etc.)

## Related pages

- [Lifecycle and Types](/concepts/threads/lifecycle-and-types/) — statuses,
  prefixes, channels, and how ThinkWork models different kinds of work
- [Routing and Metadata](/concepts/threads/routing-and-metadata/) — how
  inbound connector events map onto the thread model
- [Admin: Threads](/applications/admin/threads/) — the operator view
- [Mobile: Threads & Chat](/applications/mobile/threads-and-chat/) — the
  end-user view

## Under the hood

- **Schema:** `threads` table in Aurora Postgres, RLS-scoped per `tenant_id`.
  Primary key is a prefixed ULID (`CHAT-01H…`).
- **Resolver surface:** `packages/api/src/schema/threads/` — GraphQL
  queries, mutations, subscriptions.
- **AppSync subscriptions:** `OnThreadUpdatedSubscription`,
  `OnThreadTurnUpdatedSubscription`.
- **Inbound mapping:** connector Lambdas call the same `createThread`
  internal path, varying only by channel + metadata.
```

That's the shape. It has the hook, but then it earns the reader's time with real prose about *why* the one-container choice matters. It doesn't preempt the child pages — it sets the mental model, then points to them. Technical detail is at the bottom, clearly labeled, and a reader who only wants the conceptual picture can stop before ever reaching it.

## Self-check before you commit

A page is ready for review when:

- [ ] The hook states what the thing is and why it matters, in 1–2 sentences.
- [ ] A reader could understand the concept by reading the prose alone, skipping every code block.
- [ ] Code blocks appear only when they illustrate a specific contract or example — not as a substitute for explanation.
- [ ] The `## Under the hood` section (if present) is the last section, not scattered through.
- [ ] Frontmatter has a real `title` and a real `description` under 160 chars.
- [ ] Every internal link resolves against the current sidebar in `docs/astro.config.mjs`.
- [ ] Any stated limits, known bugs, or stubbed features are called out in a "Known limits" section — not hidden.
- [ ] There's a "Related pages" section linking to 2–5 adjacent pages.
- [ ] Canonical names (Threads, Agents, Memory, Connectors, Automations, Control) are used consistently.
- [ ] No marketing voice, no hedging, no filler openers.

If all of those are true, ship it. If not, revise first.

## Concept page skeleton (the harness lens)

Every concept page — the six top-level concept hubs (Threads, Agents, Memory, Connectors, Automations, Control) and their leaf pages — ships product-grade docs treatment under the harness frame. The page is a component of the Agent Harness for Business; the docs is the product surface that explains why the component exists, what it does, how to operate it, and how to use it.

The canonical structure has five sections, in this order:

### 1. Why this component exists in the harness *(1 paragraph)*

Lead with the problem the component solves under the harness frame. Name which operating guarantee(s) it implements (Reliability · Efficiency · Security · Traceability). One paragraph — enough to give a reader the reason this component is worth their attention before they decide whether to keep reading.

### 2. What it does *(2–3 paragraphs + bullets)*

The canonical behavior, expressed in product terms. Use the canonical names exactly: Threads, Agents, Memory, Connectors, Automations, Control. No implementation detail — that's reference docs' job. The reader should be able to reason about what the component is responsible for without reading any code.

### 3. How to configure it *(1–2 paragraphs + concrete steps)*

Map the component to its admin surface (`/applications/admin/<route>/`) or CLI flag. Name the production-grade dimensions that matter: which knobs change what, what's tenant-scoped vs deployment-scoped, what the default is and when to deviate. If the component has no first-class configuration (rare), say so explicitly and link the upstream control that does (e.g., a memory backend may be configured at the deployment level via Terraform).

When a concept page has no admin counterpart yet (`composable-skills/*`, `code-sandbox`, `compounding-memory-pipeline`, etc.), substitute the closest existing surface — a CLI command, a Terraform variable, a connector setup — rather than inventing a configure section.

### 4. Common patterns *(at least 1 worked-through scenario)*

A real workflow, not abstract description. "When you want X, do Y" — name the inputs, the components involved, the expected outcome. Cross-link `/guides/<topic>/` runbooks where the pattern is deeper than a single page can cover. The pattern is what turns the page from "documentation of a thing" into "documentation that helps you do work."

### 5. Cross-links *(footer)*

Always include this section. Link the page back into the harness:

- **Architecture** — the relevant section in `/architecture/`
- **Admin route** — `/applications/admin/<route>/` when one exists
- **Reference** — `/api/<endpoint>/` or `/sdks/<name>/<symbol>/` when applicable
- **Related concepts** — at least 2 sibling concept pages

`docs/src/content/docs/concepts/threads.mdx` is the gold-standard implementation of this skeleton. New concept pages should mirror its shape. Existing concept pages adopt the skeleton incrementally during scope-applicable edits — it is not a one-shot rewrite of every page in the corpus.

## What this guide doesn't cover

- **Design, layout, and theming** — those live in Starlight config and `custom.css`, not in writing guidance.
- **Generator pipelines** — we don't auto-generate docs from code comments. Every page is handwritten.
- **Localization** — English only for now.
- **Version differences** — the docs always describe the current main-branch state of the code. When that's not true, the page is stale.
