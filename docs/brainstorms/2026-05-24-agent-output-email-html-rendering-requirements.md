---
date: 2026-05-24
topic: agent-output-email-html-rendering
status: completed
completed_by:
  - "PR #1665"
  - "PR #1745"
---

# Agent Output → Email-Friendly HTML

## Summary

Outbound email replies from `chat-finalize → sendThreadReplyEmail` currently send the agent's raw markdown as `Content-Type: text/plain`. Recipients see asterisks, backticks, and pipe-table syntax instead of formatted prose. Build a per-channel renderer module (`channel-rendering/`) that converts agent markdown to channel-specific output; implement the email leg in v1, leaving typed slots for Slack and Teams. The email leg uses `marked` (a battle-tested GFM parser) with renderer overrides that emit inline-styled HTML safe for major email clients. `thread-reply.ts` switches its SES send to `multipart/alternative` so HTML-capable clients render the formatted version while accessibility tools and security gateways still see the raw markdown.

---

## Problem Frame

A user emails `<space>@<tenant>.thinkwork.ai`; the inbound is routed to a thread; the agent answers; `chat-finalize` calls `sendThreadReplyEmail` to deliver the response back to the original sender. The agent's reply is markdown — the same string that renders cleanly in the admin SPA's thread view — but SES sends it verbatim as `text/plain`. Outlook, Gmail, and Apple Mail show literal markdown syntax (`**bold**`, `` `code` ``, `| col | col |`), which is unprofessional and degrades trust in the agent's output.

A hand-rolled markdown renderer already exists at `packages/api/src/lib/markdown-render.ts` (used by an artifact-delivery path) but: (a) it's not wired into the email reply path at all, and (b) it doesn't handle GFM tables, which is the single most visible breakage in the screenshot that motivated this brainstorm. Even patching the existing renderer would leave us with a 200-line regex-based markdown parser that accumulates edge-case bugs over time (nested lists, emphasis-inside-links, autolinks, escapes).

A separate cost is that Thinkwork's downstream multi-channel plans (Slack and Teams agent replies, per `project_computer_slack_workspace_app_brainstorm`) will need their own markdown-to-mrkdwn / markdown-to-AdaptiveCard conversions. If the email fix grows organically inside `thread-reply.ts`, Slack and Teams will each grow their own inline renderers. A small abstraction now keeps the conversion in one module.

---

## Actors

- **A1. External email recipient** — the human reading the agent's reply in Outlook, Gmail, Apple Mail, or any standards-compliant client. Not a Thinkwork user, may not be a tenant member.
- **A2. Inbound email sender** — the same person, in their pre-reply role. They emailed the tenant's Space address and got routed into a thread; their email client and capabilities are unknown.
- **A3. Agent** — produces the markdown response. No change to authoring; the agent does not need to be aware of channel rendering.
- **A4. Future Slack/Teams renderer** — not implemented in v1 but holds a typed slot in the channel-rendering module so the next channel doesn't refactor the module's shape.

---

## Key Flows

- **F1. Cold-contact email reply (current screenshot case)**
  - **Trigger:** External email arrives at `<space>@<tenant>.thinkwork.ai`, cold-contact gate passes, thread is created with `source: email_cold_contact`.
  - **Actors:** A1, A2, A3
  - **Steps:** Agent finishes turn → `chat-finalize` calls `sendThreadReplyEmail(body=responseText)` → renderer module converts markdown to HTML + plaintext → SES sends `multipart/alternative` to the original sender → recipient's email client renders the HTML version.
  - **Outcome:** Tables, code blocks, bold/italic, links, lists all render as formatted HTML. Threading headers (`Message-ID`, `In-Reply-To`, `References`, `X-Thinkwork-Reply-Token`) unchanged from today.
  - **Covered by:** R1, R2, R3, R6, R8, R9

- **F2. Reply-token continuation**
  - **Trigger:** Recipient hits Reply in their email client; their reply lands in the same thread via the `X-Thinkwork-Reply-Token` chain; agent answers again.
  - **Actors:** A1, A2, A3
  - **Steps:** Same as F1; the renderer applies on every agent turn that triggers `sendThreadReplyEmail`. Quoted prior-turn content from the recipient's reply client is the recipient's quoted text in their reply, not something we need to render.
  - **Outcome:** Every agent-side message in a long-running email thread renders as HTML.
  - **Covered by:** R1, R2

- **F3. Artifact delivery (existing path that also gets the new renderer)**
  - **Trigger:** A user-facing surface invokes the existing `markdownToHtml` / `wrapEmailHtml` helpers for non-thread-reply emails (the original consumers of `packages/api/src/lib/markdown-render.ts`).
  - **Actors:** Whoever calls today
  - **Steps:** Callers migrate to the new `renderForEmail` exported from `channel-rendering/`. Old `markdown-render.ts` is deleted in the same PR.
  - **Outcome:** Single markdown renderer in the codebase; artifact emails inherit GFM table support and consistent inline styling.
  - **Covered by:** R10

---

## Requirements

**Rendering correctness**

- **R1.** Agent markdown that uses GFM features — headings (`#` through `######`), bold/italic, inline code, fenced code blocks, ordered and unordered lists (including nested lists at one level of depth), blockquotes, horizontal rules, links, and **GFM pipe tables** — must render as semantically correct HTML elements (`<h1>`–`<h6>`, `<strong>`, `<em>`, `<code>`, `<pre><code>`, `<ol>`/`<ul>`/`<li>`, `<blockquote>`, `<hr>`, `<a>`, `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<th>`/`<td>`).
- **R2.** Every block-level element produced by the renderer carries **inline styles** sufficient to render correctly in Outlook (desktop + web), Gmail (web + iOS + Android), and Apple Mail. No reliance on `<style>` blocks or external stylesheets — many email clients strip them.
- **R3.** Markdown image syntax (`![alt](url)`) renders as `<img src="url" alt="alt">` with an inline `max-width` for mobile clients. No CID embedding, no fetching, no inlining of attachments in v1; remote-image-block behavior is the recipient's email client's call.

**Pipeline shape**

- **R4.** A new module `packages/api/src/lib/channel-rendering/` (exact path is a planning detail; the shape is fixed) exposes a single email entry point — `renderForEmail(markdown: string) → { html: string, text: string }` — that returns both the rendered HTML and a plaintext version. The plaintext version may be the raw markdown verbatim (see R5).
- **R5.** The plaintext leg of the `multipart/alternative` message is the **agent's raw markdown** (passed through unchanged). Accessibility tools and security gateways that strip HTML get readable content; no second markdown-stripping pipeline is required.
- **R6.** `packages/api/src/lib/email/thread-reply.ts` (the only v1 caller of `renderForEmail`) constructs the SES `SendRawEmailCommand` with `Content-Type: multipart/alternative` and a boundary separating the `text/plain` part (R5) from the `text/html` part (R1, R2). All other SES headers (`From`, `To`, `Reply-To`, `Subject`, `Message-ID`, `In-Reply-To`, `References`, `X-Thinkwork-Reply-Token`, `MIME-Version`) are unchanged from today's implementation.

**Module shape for future channels**

- **R7.** The `channel-rendering/` module declares typed entry points for additional channels (`renderForSlack`, `renderForTeams`) but the v1 PR implements only `renderForEmail`. Slack and Teams entry points may exist as `throw new Error("not implemented")` stubs or may be absent from the v1 export surface entirely (planning-time choice); what must NOT happen is downstream channel work re-architecting the email module to accommodate them.

**Library**

- **R8.** The email leg uses the `marked` npm package (or a clearly-justified equivalent at planning time) as the markdown parser, with custom renderer overrides applied at the `marked.Renderer` level to add the inline styles required by R2.
- **R9.** No React, no React DOM, no `@react-email/*` dependency added in v1. The render module is pure-TS with one well-scoped markdown-parser dependency.

**Cleanup**

- **R10.** The existing `packages/api/src/lib/markdown-render.ts` and `wrapEmailHtml` callers migrate to `channel-rendering/`. The old module is deleted in the same PR. No two markdown renderers in the codebase at end-of-PR.

**Quality**

- **R11.** Rendering is covered by snapshot tests against a representative corpus of agent outputs: a simple paragraph, a GFM pipe table, a fenced code block, a nested ordered/unordered list, a blockquote, a heading hierarchy, a paragraph with bold + italic + inline code + a link, and an image. The corpus lives under the module's test directory.
- **R12.** The rendered HTML must escape user-provided content correctly (no XSS via `[link](javascript:...)` or via raw HTML in the agent's markdown body). `marked`'s default behavior plus `sanitize: true` (or its current equivalent) is the floor; planning verifies the right knob.

---

## Acceptance Examples

- **AE1. Covers R1, R2, R6.** Given an agent reply containing the markdown table from the motivating screenshot (CRM opportunities with `#`, `Title`, `Stage`, `Sales Rep`, `Created`, `Notes` columns), when `sendThreadReplyEmail` runs, then the recipient's Gmail / Apple Mail / Outlook desktop client renders an actual `<table>` with visible borders, header row styling, and proper cell padding. The raw pipe-syntax does not appear anywhere in the rendered body.

- **AE2. Covers R1.** Given an agent reply containing a fenced code block with language hint (```` ```ts ... ``` ````), when the reply lands in the recipient's inbox, then the code renders inside `<pre><code>` with monospace font and a light background tint, preserving whitespace and not displaying the triple-backtick fences.

- **AE3. Covers R5, R6.** Given a recipient whose email client (or accessibility tool) renders only the `text/plain` MIME part, when they open the message, then they see the agent's raw markdown verbatim — readable, with the markdown syntax present but no broken HTML.

- **AE4. Covers R12.** Given an agent reply (whether by mistake or adversarial prompt) containing a markdown link with a `javascript:` href, when the reply is rendered, then the `<a>` tag either omits the href, sanitizes it to `#`, or refuses to render the link. The recipient cannot trigger script execution via the link.

- **AE5. Covers R10.** Given the artifact-delivery path that today calls `markdownToHtml`, after the PR lands, then that path calls `renderForEmail` from `channel-rendering/` and the old `packages/api/src/lib/markdown-render.ts` file is gone. A grep for `markdown-render` in the repo (excluding the deletion commit) returns zero hits.

- **AE6. Covers R7.** Given a future PR that adds Slack reply rendering, when its author opens the `channel-rendering/` module, then they find a typed `renderForSlack` slot to implement and do not need to refactor `renderForEmail` to accommodate the new channel.

---

## Success Criteria

- The email Eric received as the screenshot for this brainstorm, if regenerated, renders as formatted HTML with the table rendered as a table — across Gmail web, Apple Mail (macOS + iOS), and Outlook web.
- A future contributor adding the Slack channel (per the open Slack workspace-app brainstorm) does not need to read or rewrite `thread-reply.ts` or the email renderer.
- The codebase has exactly one markdown renderer at end-of-PR.

---

## Scope Boundaries

**Not included in v1:**

- Branded templates, Thinkwork logo, agent identity in header, tenant-themeable accent colors, per-tenant signature lines, footer chrome of any kind.
- `@react-email/*` adoption, React rendering in any Lambda.
- Slack and Teams renderer implementations.
- Code syntax highlighting in fenced code blocks. Monospace font + light background is enough.
- Inline image attachments (CID embedding). Remote `<img>` URLs only.
- Per-recipient or per-tenant rendering preferences (text-only opt-out, branding toggle, etc.).
- Email-client-specific fork rendering (e.g., a separate Outlook-Word-engine pass).
- Localizing rendered output (RTL languages, language-tagged content).

**Deferred for later (likely future brainstorms):**

- **Branded templates.** When and if Thinkwork wants the agent's emails to look like marketing-quality transactional emails (logo, agent avatar, accent color, footer with unsubscribe), that's a separate scope that earns `@react-email/components` adoption. The per-channel module structure leaves room for this without rework — `renderForEmail` can switch its internal template from "bare prose" to "branded template" transparently.
- **Slack and Teams channel renderers.** Tracked in `project_computer_slack_workspace_app_brainstorm`. The renderer module exists in v1 to receive these.
- **CID-embedded images.** When agents start producing attachments (charts, generated images), inlining vs. linking becomes a real decision. Not v1.

**Outside this product's identity:**

- Marketing-style email content (CTAs, hero images, header/footer chrome). Thinkwork's email is transactional agent communication, not marketing.
- The agent learning to author email-formatted output directly. The agent writes markdown; the renderer converts.

---

## Key Decisions

- **Per-channel renderer module over inline conversion inside `thread-reply.ts`.** Inline rendering inside the email send path is simpler in v1 but guarantees that Slack and Teams will each grow their own inline converters. The module is ~50 LOC of additional scaffolding over inline conversion (an exported function and a directory); the long-term cost of duplicated channel-renderers is much higher. The module shape is the right shape now even though only the email leg is implemented.
- **`marked` over hand-rolling table support, over `@react-email/components`.** `marked` is a battle-tested GFM parser with renderer hooks for inline styling. Patching the existing hand-rolled regex parser would solve the table case but accumulates fragility (nested lists, escapes, edge cases). `@react-email/components` brings ~250KB of React weight to a Lambda that doesn't need React component authoring; the value of React weight only earns its keep if branded templates land soon, which the chosen scope explicitly defers.
- **`multipart/alternative` with raw markdown as plaintext fallback.** Most modern clients render the HTML part; accessibility tools and some security gateways prefer plaintext. Sending raw markdown as the plaintext part is a deliberate choice — readers of the plaintext version see prose with `**` and `|` characters, but the content is fully readable. A second pipeline to strip markdown into prose plaintext is overkill for the value it adds.
- **Migrate existing `markdown-render.ts` callers in the same PR.** Leaving them on the old renderer means living with two markdown renderers indefinitely; one of them will drift. The migration is small (single-call-site grep) and the cleanup is consequential — one markdown renderer, one bug surface, one place to add a feature.
- **No branding in v1.** The user's explicit scope choice. The renderer outputs clean, well-typed prose. If branded templates ever ship, they layer on top of the same `renderForEmail` interface without rewriting it.
- **No Slack/Teams implementation in v1.** Slack and Teams have entirely different rendering targets (mrkdwn, AdaptiveCards) and are tracked in their own brainstorms. The renderer module exposes typed entry points so that work doesn't refactor this module.

---

## Dependencies / Assumptions

- **SES production access is live on dev** (granted 2026-05-24 in this session). The auto-delivery path in `chat-finalize/process-finalize.ts:411-422` works end-to-end today; this brainstorm fixes the rendered output, not the delivery channel.
- **`marked` ships TypeScript types** in its npm package. Verified at planning time; no `@types/marked` workaround needed.
- **Email clients with HTML rendering disabled** (text-only Mutt users, security policies that strip HTML) will fall through to the raw-markdown plaintext part. This is acceptable per the user's scope choice — they get readable content, even if not pretty.
- **Email clients that strip `<style>` blocks but render inline `style=` attributes** are the working assumption. This is true for Gmail, Outlook web, Apple Mail. The renderer override approach guarantees we ship inline styles only.
- **The agent's markdown output is trusted up to XSS sanitization.** Agents are not malicious actors in our threat model; the XSS sanitization is defense-in-depth against accidental `javascript:` hrefs the agent might emit or against future cases where the agent quotes user-supplied content verbatim.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- **[Affects R7][Technical]** Whether `renderForSlack` and `renderForTeams` are exported as `throw` stubs or are entirely absent from v1's export surface. Stubs document intent more clearly; absence is one less code path to maintain. Planner picks.
- **[Affects R8][Technical]** Whether to use `marked`'s default renderer with overrides for specific elements, or to subclass `marked.Renderer` wholesale. Same outcome; small style preference.
- **[Affects R12][Technical]** The exact XSS sanitization knob in current `marked` releases (deprecated `sanitize: true` vs the recommended DOMPurify integration). Verified at planning time.
- **[Affects R3][Design]** Inline `max-width` value for `<img>` tags. 600px is the conventional email-content width; planner confirms.
- **[Affects R10][Process]** Whether the artifact-delivery migration is in the same PR (recommended) or a follow-up. Bundling is cleaner; splitting is faster to ship the visible-bug fix. User chose bundling in the brainstorm; planner confirms it's tractable.
- **[Affects R1][Design]** Whether nested-list rendering goes deeper than one level (e.g., 3+ levels). `marked` supports arbitrary depth; the question is whether the inline-style overrides need depth-aware adjustments. Probably no — defaults are fine — but verified at planning.
