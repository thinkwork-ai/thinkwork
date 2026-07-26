---
module: apps/web
date: 2026-07-25
last_updated: 2026-07-25
category: ui-bugs
problem_type: logic_error
component: web
severity: medium
related_components:
  - thread_view
  - markdown_rendering
applies_when:
  - "Rendering per-turn data (citations, evidence, annotations) inside an assistant message"
  - "Rewriting markdown before handing it to Streamdown so custom markers become components"
  - "Introducing a custom URI scheme or raw HTML tag into assistant markdown"
  - "Unit tests for a rendering feature pass but the feature does nothing in the browser"
tags:
  - streamdown
  - markdown
  - sanitization
  - citations
  - thread-view
  - testing-gaps
---

# Inline citations shipped inert twice — the tests could not see it

## Context

Knowledge-base citations render as pills inside the agent's answer: the model
writes `[n]` markers, the web app rewrites them, and each becomes a component
linking to the cited document and page.

The feature shipped to production **twice** as code that deployed correctly and
did nothing. Both defects were invisible to the test suite and to the deploy
pipeline; both were found only by reading the deployed bundle and the rendered
DOM.

## Defect 1 — per-turn data attached to the wrong message

`TaskThreadView` resolves a turn with:

```ts
const turn = turnByUserMessageId.get(message.id);
```

The map is keyed by the message that **triggered** the turn — the user's. The
`[n]` markers live in the **agent's reply**, whose own id has no entry in that
map. Every reply therefore resolved `turn === undefined`, produced an empty
citation map, and left markers as literal text.

A visible tell existed the whole time: **"Worked for 56s" and "Used N sources"
render _above_ the agent's reply**, because those also hang off the user
message, which is where the turn does resolve. Layout was showing the data
model.

### Fix

Anchor per-turn render data to the reply using the same rule the document cards
already used — the next non-`USER` message after the triggering one — and pass
it down as an explicit prop rather than re-deriving it from a `turn` that is
structurally absent at that point in the tree.

```ts
const reply = transcriptMessages
  .slice(index + 1)
  .find((candidate) => candidate.role.toUpperCase() !== "USER");
citationsByMessageId.set(reply?.id ?? message.id, citations);
```

**Rule:** a turn has two message anchors — the request and the reply. Decide
which one your data belongs to; do not assume the map you have is keyed by it.

## Defect 2 — the markdown renderer silently rewrote the output

With the map arriving, markers were rewritten to `[1](thinkwork-cite:1)` and
the anchor override was supposed to swap in the pill. The rendered DOM read:

```
Always add the new code at the bottom 1 [blocked].
```

Streamdown's URL sanitizer rejected the unknown `thinkwork-cite:` scheme and
replaced it with a literal `[blocked]` placeholder. The anchor override never
ran. No console error, no exception.

The obvious alternative also fails silently. Emitting a custom tag
(`<cite data-cite="1"></cite>`) and allowing it via `allowedTags` renders
**nothing** — markdown does not parse inline HTML into elements without
`rehype-raw`, so the tag is simply dropped:

```
Always add the new code at the bottom .
```

### Fix

Use a **fragment href**, which passes sanitization untouched:

```ts
export const CITATION_HREF_PREFIX = "#thinkwork-cite-";
// [1](#thinkwork-cite-1,2)  → anchor override → <InlineCitation citations={…} />
```

**Rule:** assistant markdown passes through a sanitizer. Any custom scheme,
protocol, or tag you invent is subject to it, and rejection is silent — it
degrades output rather than raising. Verify the rendered DOM, not the string
you produced.

## Why the tests passed both times

The unit tests called the parsing and rewriting functions **directly**. They
proved `linkCitationMarkers` and `knowledgeCitationsFromInvocations` behave
correctly in isolation — which was true, and irrelevant. Neither defect lived
in those functions:

- Defect 1 was in the **wiring** (which message the map attaches to).
- Defect 2 was in the **renderer** (what Streamdown does with the output).

A test that never renders a thread cannot see either.

### The test that does catch them

Render a real thread — user message, agent reply containing `[1]`, turn
attached to the **user** message, matching production shape — and assert on the
rendered output:

```tsx
expect(
  screen.getByRole("button", { name: /Open source CX-0215 … · p\.1/i }),
).toBeTruthy();
// A bare "[1]" or a "[blocked]" placeholder means the pill never rendered.
expect(document.body.textContent).not.toMatch(/\[1\]|\[blocked\]/);
```

Asserting on the **absence of the failure text** matters as much as asserting
presence: both defects produced plausible-looking prose with the marker quietly
missing or mangled.

## Verifying a web fix actually shipped

Deploy success does not mean the code is live and working. Two cheap checks:

```bash
# 1. Is the new code in the served bundle? Pick a class or literal that
#    changed, and confirm the OLD one is gone.
aws s3 sync s3://<web-origin-bucket>/assets/ ./assets --exclude "*" --include "*.js" --quiet
grep -l 'max-w-\[75px\]' assets/*.js     # new
grep -l 'border-primary/25' assets/*.js  # old — expect no match

# 2. Does it render? Open the page and read the DOM.
```

Note that app code may land in a chunk whose name is unrelated to its contents
(here, everything was bundled into a `mermaid-*.js` chunk) — grep all assets
rather than guessing the filename.

## Related

- `apps/web/src/components/ai-elements/inline-citation.tsx`
- `apps/web/src/components/ai-elements/response.tsx`
- `apps/web/src/components/workbench/TaskThreadView.tsx`
- PRs #4098, #4101, #4102, #4103
