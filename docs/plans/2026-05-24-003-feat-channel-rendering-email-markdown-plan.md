---
title: "feat: Channel-rendering module + email markdown→HTML"
type: feat
status: active
date: 2026-05-24
origin: docs/brainstorms/2026-05-24-agent-output-email-html-rendering-requirements.md
---

# feat: Channel-rendering module + email markdown→HTML

## Summary

Replace the hand-rolled markdown parser at `packages/api/src/lib/markdown-render.ts` with a small per-channel renderer module (`packages/api/src/lib/channel-rendering/`) that uses `marked` plus inline-style renderer overrides plus `isomorphic-dompurify` for XSS sanitization. The email leg, `renderForEmail(markdown) → { html, text }`, is the only channel implemented in v1; `renderForSlack` / `renderForTeams` are intentionally absent from the export surface and added by future channel work. Wire `packages/api/src/lib/email/thread-reply.ts` to emit `multipart/alternative` SES messages so recipients see formatted HTML while accessibility tools and security gateways get the raw markdown as the plaintext fallback. Migrate the email call sites in `packages/api/src/lib/artifact-delivery.ts` and delete `markdown-render.ts` in the same PR; the file's PDF call site (`renderPdfHtml`) inlines its own minimal markdown→HTML logic because the email renderer's inline-style fragment is the wrong output shape for PDF.

---

## Problem Frame

The motivating evidence is the screenshot the user attached to the brainstorm: an inbound email triggered an agent thread, the agent answered with a markdown table of CRM opportunities, `chat-finalize → sendThreadReplyEmail` delivered the response — and the recipient saw literal `**bold**`, backticks, and pipe-syntax columns instead of formatted prose. The full causal chain is one line: `thread-reply.ts:157` sets `Content-Type: text/plain` and ships the agent's markdown verbatim, so no rendering happens at all. A working HTML renderer (`packages/api/src/lib/markdown-render.ts`) sits unused in the same package because it was built for a different consumer (artifact delivery) and never wired into the email-reply path.

Patching the hand-rolled renderer in place is the smallest visible-bug fix, but the brainstorm rejected it: the file is 200 lines of regex, lacks GFM table support, and will accumulate edge-case bugs (nested lists, emphasis-inside-links, autolinks, link sanitization) as the agent's output grows in shape. The brainstorm landed on `marked` for parsing — battle-tested, GFM-complete, ~30 KB — with renderer overrides applied at the `marked.Renderer` level to ship inline styles per email-client compatibility constraints. Slack and Teams reply paths are tracked separately ([project_computer_slack_workspace_app_brainstorm](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_computer_slack_workspace_app_brainstorm.md)); the module shape reserves room for them without committing v1 code.

The single non-thread-reply consumer of the old renderer is `artifact-delivery.ts`. It has **three** invocations of the old API: `renderEmailDelivery` calls `markdownToHtml` (line 76) and `wrapEmailHtml` (line 78); `renderPdfHtml` calls `markdownToHtml` (line 145). Only the email path migrates to `renderForEmail` — `renderPdfHtml` produces a full `<!DOCTYPE html>` + `<style>` document for Puppeteer/wkhtmltopdf, which is a fundamentally different rendering target from email's bare inline-style fragment. The PDF path keeps its own minimal markdown-to-HTML logic (either inlined into `artifact-delivery.ts` or via direct `marked.parse()` without the email renderer's overrides). Migrating it in this PR keeps the codebase at one markdown renderer **for email** and avoids the drift trap (existing email code keeps using the old module forever because "it works"). The artifact email path inherits GFM-table support and consistent inline styling as a side effect.

---

## Requirements

Carried verbatim from origin where possible; tagged by R-ID for traceability.

- **R1.** GFM features (headings, bold/italic, inline code, fenced code blocks, ordered/unordered lists with at least one level of nesting, blockquotes, horizontal rules, links, and **pipe tables**) render as semantically correct HTML elements. (see origin: `docs/brainstorms/2026-05-24-agent-output-email-html-rendering-requirements.md`)
- **R2.** Every block-level element carries **inline `style=` attributes** sufficient to render correctly in Outlook (desktop + web), Gmail (web + iOS + Android), and Apple Mail. No `<style>` blocks, no external stylesheets.
- **R3.** Markdown image syntax renders as `<img src="url" alt="alt" style="max-width:600px;height:auto">`. No CID embedding, no fetch-and-inline. Remote-image-block behavior is the recipient client's call.
- **R4.** A new module `packages/api/src/lib/channel-rendering/` exposes `renderForEmail(markdown: string) → { html: string, text: string }`.
- **R5.** The `text` field returned by `renderForEmail` is the **agent's raw markdown verbatim**. No second markdown-stripping pipeline.
- **R6.** `packages/api/src/lib/email/thread-reply.ts` sends `Content-Type: multipart/alternative` with a boundary separating `text/plain` (R5) from `text/html` (R1 + R2). All other SES headers (`From`, `To`, `Reply-To`, `Subject`, `Message-ID`, `In-Reply-To`, `References`, `X-Thinkwork-Reply-Token`, `MIME-Version`) are unchanged.
- **R7.** `renderForSlack` and `renderForTeams` are **absent** from the v1 export surface. Future channel work adds them; this PR does not ship stubs.
- **R8.** The email leg uses the `marked` npm package as the markdown parser with custom renderer overrides for inline styles per R2.
- **R9.** No React, no React DOM, no `@react-email/*` dependency added.
- **R10.** Email-targeted callers in `packages/api/src/lib/artifact-delivery.ts` migrate to `renderForEmail`. The file has three call sites of the old API: `renderEmailDelivery` calls `markdownToHtml` (line 76) and `wrapEmailHtml` (line 78) — both migrate. `renderPdfHtml` calls `markdownToHtml` (line 145) — does **not** migrate because PDF is a different rendering target (full `<!DOCTYPE html>` + `<style>` block via Puppeteer/wkhtmltopdf, not an email-safe inline-style fragment); the PDF path either inlines a minimal markdown-to-HTML helper into `artifact-delivery.ts` or calls `marked.parse()` directly without the email renderer's overrides. `packages/api/src/lib/markdown-render.ts` is deleted in the same PR once both email call sites have migrated and the PDF path has its own substitute. Post-PR grep for `markdown-render` returns zero hits in code.
- **R11.** Snapshot tests against a representative corpus: simple paragraph, GFM pipe table, fenced code block, nested ordered/unordered list (2 levels deep verified explicitly, plus a 4-level case to guard against renderer hardcoding), blockquote, heading hierarchy, paragraph with bold + italic + inline code + link, image, link with `javascript:` URL (sanitized), `data:` URL in image src (sanitized), and an SVG fragment in agent markdown (sanitized).
- **R12.** Output HTML escapes user-provided content. **Primary defense:** `isomorphic-dompurify` sanitizes the output HTML before it leaves the renderer; the sanitizer config must explicitly pin: `USE_PROFILES: { html: true }` (closes SVG/MathML namespace bypasses), `FORBID_TAGS: ['svg', 'math', 'style', 'script', 'iframe', 'object', 'embed']`, `FORBID_ATTR: ['style']` if renderer overrides interpolate token values into `style=` (otherwise inline styles are allowed but must be hardcoded, never interpolated), and `ALLOWED_URI_REGEXP: /^https?:/i` (blocks `data:`, `blob:`, `vbscript:`, `javascript:` schemes across all attributes — `href`, `src`, `srcset`, etc., not just `<a href>`). **Defense in depth:** `marked` renderer overrides for `link` and `image` reject non-`http(s):` URIs at parse time before DOMPurify runs, so visible link/alt text survives the sanitization even when the URL is stripped. **Header injection:** any string interpolated into a raw MIME header line (`Subject`, `From`, `To`, `Reply-To`, `In-Reply-To`, `References`, `X-Thinkwork-Reply-Token`) must have `\r`, `\n`, and `\r\n` stripped before construction to prevent CRLF injection — this is a pre-existing gap in `thread-reply.ts` that U2 fixes since we are touching the header-construction code anyway.

---

## Scope Boundaries

### Not included in v1

- Branded templates, Thinkwork logo, agent identity in header, tenant-themeable accent colors, per-tenant signature lines, footer chrome of any kind.
- `@react-email/*` adoption, React rendering in any Lambda.
- Slack and Teams renderer implementations.
- Code syntax highlighting in fenced code blocks. Monospace font + light background only.
- Inline image attachments (CID embedding). Remote `<img>` URLs only.
- Per-recipient or per-tenant rendering preferences (text-only opt-out, branding toggle).
- Email-client-specific fork rendering (separate Outlook-Word-engine pass).
- Localizing rendered output (RTL languages, language-tagged content).
- `renderForSlack` / `renderForTeams` stubs in the export surface.

### Deferred for later (likely future brainstorms)

- **Branded templates.** When Thinkwork wants the agent's emails to look like marketing-quality transactional emails (logo, agent avatar, accent color, footer with unsubscribe), that's a separate scope that earns `@react-email/components` adoption. The per-channel module's `renderForEmail` interface accepts this transparently — its internal template can switch from "bare prose" to "branded template" without changing callers.
- **Slack and Teams channel renderers.** Tracked in `project_computer_slack_workspace_app_brainstorm`. This module's directory exists in v1 to receive them.
- **CID-embedded images.** Decision point when agents start producing attachments (charts, generated images). Not v1.

### Outside this product's identity

- Marketing-style email content (CTAs, hero images, header/footer chrome). Thinkwork's email is transactional agent communication, not marketing.
- The agent learning to author email-formatted output directly. The agent writes markdown; the renderer converts.

---

## Context & Research

### Files this plan touches

- `packages/api/src/lib/markdown-render.ts` — hand-rolled regex parser, deleted at end of PR (R10). Header comment already carries a TODO recommending the switch to `marked`.
- `packages/api/src/lib/artifact-delivery.ts` — three call sites of the old API: `markdownToHtml` at line 76 and `wrapEmailHtml` at line 78 (both inside `renderEmailDelivery`, both migrate); `markdownToHtml` at line 145 (inside `renderPdfHtml`, does **not** migrate — PDF is a different rendering target, see R10).
- `packages/api/src/lib/email/thread-reply.ts` — single-part text/plain SES send at line 157. Becomes multipart/alternative.
- `packages/api/src/lib/email/cold-contact-trigger.ts` — does NOT call the renderer (verified); inbound trigger only. Out of scope.
- `packages/api/src/lib/chat-finalize/process-finalize.ts:411-422` — caller of `sendThreadReplyEmail`. Unchanged; passes `body: responseText` as before.

### Existing patterns to honor

- **`inert-first-seam-swap-multi-pr-pattern` (2026-05-08).** The team's preferred shape for "introduce new module, migrate callers." For this PR's size and risk, applied as **inert-then-flip within a single PR** (commit 1: new module + tests, commit 2: flip thread-reply, commit 3: migrate artifact-delivery + delete old module). Same property — old module keeps working until everyone is off it.
- **Hand-rolled `markdown-render.ts` style choices** (existing token values, inline styles for `<table>`, `<blockquote>`, headings, code blocks). Mirror these in the new `marked` renderer overrides so existing artifact-delivery visuals do not regress. Concrete values are an execution detail; the principle is "preserve the visual contract."
- **SES `SendRawEmailCommand`** is the existing send primitive (`thread-reply.ts:163-172`). Stay on it — the alternative `sesv2 SendEmailCommand` has different MIME affordances we do not need.

### Institutional learnings consulted

- **ce-learnings-researcher** ran across `docs/solutions/`. Zero direct hits for email rendering, `marked`, MIME multipart, or email-client CSS. This is the first time the team has tackled the problem.
- Tangentially relevant: `inert-first-seam-swap-multi-pr-pattern-2026-05-08.md` (shape pattern, applied above); `every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` (SES sends count as side-effecting external calls; no new mutation surface ships here, so nothing to gate).

### External grounding

- `marked` documentation: https://marked.js.org/. Renderer overrides via `new marked.Renderer()` and assigning to `.table`, `.code`, `.link`, `.image`, `.blockquote`, `.list`, `.listitem`, `.heading`, `.hr`, `.paragraph`. Each returns the HTML string for that token. `marked.setOptions({ renderer })` activates the override set.
- `isomorphic-dompurify` for Node-side HTML sanitization. Pinning to a recent stable; the implementing agent selects the version at lockfile time.
- Email-client inline-style conventions (verified at planning time; baseline expectations carried into renderer overrides):
  - `<table>` for layout: `border-collapse:collapse;width:100%;margin:12px 0`
  - `<th>` / `<td>`: `padding:6px 10px;border:1px solid #e5e5e5;text-align:left;vertical-align:top`
  - `<th>`: add `background:#f5f5f5;font-weight:600`
  - `<pre><code>`: `background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;overflow-x:auto;font-family:Menlo,Consolas,monospace;font-size:13px`
  - `<code>` inline: `background:#f3f4f6;padding:2px 4px;border-radius:3px;font-family:Menlo,Consolas,monospace;font-size:0.9em`
  - `<blockquote>`: `border-left:3px solid #d1d5db;padding-left:12px;margin:8px 0;color:#6b7280`
  - `<a>`: `color:#3b82f6;text-decoration:underline`
  - `<img>`: `max-width:600px;height:auto;display:block;margin:8px 0`
  - `<hr>`: `border:none;border-top:1px solid #e5e5e5;margin:16px 0`

These mirror what the existing `markdown-render.ts` ships today, plus the table styling it lacks. Implementer may adjust if email-client testing surfaces issues.

---

## Key Technical Decisions

- **`marked` + `isomorphic-dompurify` over hand-patching the regex parser.** Patching the hand-rolled renderer is the smallest change but accumulates fragility. `marked` is GFM-complete and battle-tested; DOMPurify is the industry-standard sanitizer for Node + browser. Total dependency cost is small relative to the engineering hours saved over the next year of edge-case bug fixes the regex parser would otherwise produce.
- **DOMPurify over `marked.walkTokens`-based stripping.** `marked` ≥ v10 deprecated its built-in `sanitize` option and recommends an external sanitizer. `walkTokens` would work but requires hand-maintaining an allowlist of safe HTML; DOMPurify's allowlist is maintained for us and updated against new XSS vectors. The dependency cost (~50 KB) is worth the security posture.
- **`multipart/alternative` with raw markdown as the plaintext part.** The agent's markdown is already human-readable prose with `**` and `|` characters; that's an acceptable accessibility fallback. A separate prose-strip pipeline is over-engineering for the value it adds.
- **`SendRawEmailCommand` over `SendEmailCommand`.** Already in use at `thread-reply.ts:163`. Building a multipart message inside the raw MIME body is a one-time MIME-boundary plumbing job; switching to `SendEmailCommand` would force a rewrite of the threading-header path (`In-Reply-To`, `References`, `X-Thinkwork-Reply-Token` are passed via the `Headers` parameter and the API surface is messier).
- **`renderForSlack` / `renderForTeams` absent from v1 exports.** Documentation by absence is cleaner than `throw new Error("not implemented")` stubs. When Slack/Teams ship, they create the exports — the planner reading this plan understands the slots exist by the directory's name.
- **Migrate `artifact-delivery.ts`'s email path in the same PR; leave the PDF path alone.** R10 of the brainstorm commits to one markdown renderer for email. `renderEmailDelivery` (lines 76 + 78) migrates to `renderForEmail`. `renderPdfHtml` (line 145) stays on its own minimal markdown logic because PDF rendering wants a full `<!DOCTYPE html>` + `<style>` document, not an inline-style email fragment. Low blast radius for the email migration; PDF visual contract untouched.
- **DOMPurify is the primary XSS defense; renderer overrides are defense-in-depth.** The `marked` `link` and `image` overrides reject non-`http(s):` URIs at parse time so the visible link text survives the strip, but the authoritative sanitization pass is DOMPurify with `USE_PROFILES: { html: true }`, `FORBID_TAGS: ['svg','math','style','script','iframe','object','embed']`, and `ALLOWED_URI_REGEXP: /^https?:/i`. Without those pins, default DOMPurify allows `data:`, `blob:`, and SVG namespace bypasses that the renderer-level checks would not catch (image `src`, SVG `<use href>`, MathML `<mtext>`).
- **Strip CRLF from header-interpolated values.** Existing `thread-reply.ts` interpolates `subjectFromMessage`, `senderEmail`, and `originalMessageId` directly into MIME header lines joined on `\r\n` — a crafted Subject line can inject additional headers (`Bcc:`, etc.). Since U2 rewrites that header block anyway, fix the pre-existing CRLF-injection gap by stripping `\r`, `\n`, and `\r\n` from every interpolated string before construction. Out-of-scope to refactor the broader inbound-email path; in-scope to not propagate the bug.

---

## Implementation Units

### U1. Build `channel-rendering/` module with `renderForEmail`

**Goal:** Create the new module at `packages/api/src/lib/channel-rendering/` exposing `renderForEmail(markdown: string) → { html: string, text: string }`. Implementation uses `marked` with renderer overrides for inline-styled HTML, then `isomorphic-dompurify` to sanitize the output before returning. Ship the snapshot-test corpus from R11.

**Requirements:** R1, R2, R3, R4, R5, R8, R9, R12.

**Dependencies:** none.

**Files:**
- Create: `packages/api/src/lib/channel-rendering/index.ts` — public exports (`renderForEmail`).
- Create: `packages/api/src/lib/channel-rendering/email-renderer.ts` — `marked` configuration, `Renderer` overrides, DOMPurify wiring.
- Create: `packages/api/src/lib/channel-rendering/__tests__/email-renderer.test.ts` — corpus tests.
- Modify: `packages/api/package.json` — add `marked` and `isomorphic-dompurify` dependencies.

**Approach:**
- `renderForEmail` is a small pure function: input markdown → output `{ html, text }`. `text` is the input markdown verbatim (R5); `html` is the result of `marked.parse(markdown)` post-processed by `DOMPurify.sanitize(html, sanitizeConfig)` where `sanitizeConfig` is the explicit allowlist below.
- `marked` is configured with a `Renderer` instance whose overrides emit inline-styled HTML for `table`, `tableRow`, `tableCell`, `code` (fenced), `codespan` (inline), `link`, `image`, `blockquote`, `list`, `listitem`, `heading`, `hr`, `paragraph`. Style values follow the Context & Research → External grounding table. Style values are **hardcoded strings**; renderer overrides must not interpolate token values (href, src, alt, text) into `style=` attributes — interpolate only into `href=`, `src=`, `alt=`, or element text, with appropriate escaping.
- The `link` and `image` renderer overrides reject any URI whose scheme is not `http:` or `https:` (covers `javascript:`, `data:`, `blob:`, `vbscript:`, `file:`, `mailto:`, etc.) by omitting the attribute entirely. The visible link text and `alt` text survive, which keeps the rendered output legible even when the URL is stripped. This is **defense in depth** — DOMPurify is the authoritative pass below.
- `DOMPurify.sanitize` is called with this explicit config (pin all four — defaults are not safe for agent-controlled content): `USE_PROFILES: { html: true }` (closes SVG/MathML namespace bypasses), `FORBID_TAGS: ['svg', 'math', 'style', 'script', 'iframe', 'object', 'embed', 'form', 'input']`, `FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']` (DOMPurify strips `on*` by default but pinning is explicit), `ALLOWED_URI_REGEXP: /^https?:/i` (applies across `href`, `src`, `srcset`, `formaction`, etc., not just `<a href>` — blocks `data:`, `blob:`, `vbscript:`, `javascript:` everywhere).
- The module's `index.ts` exports ONLY `renderForEmail`. No `renderForSlack`, no `renderForTeams`. The directory's name documents the intent.

**Execution note:** Implement test-first against the snapshot corpus from R11. Snapshots are HTML fragments; assertions verify structure (presence of `<table>`, `<pre><code>`, `<a href="...">`) and inline styles for the key elements (table border, code block background). The XSS case is an explicit assertion: `[click](javascript:alert(1))` renders without an executable href.

**Patterns to follow:**
- `packages/api/src/lib/markdown-render.ts` style choices for tables, code blocks, blockquotes — the existing visual contract for artifact delivery. The new overrides preserve these (and add table styling).
- The `inert-first-seam-swap-multi-pr-pattern` (commit shape) — this unit ships the new module with tests but does not touch any caller; the seam swap happens in U2 and U3.

**Test scenarios:**
- **Happy path: paragraph.** `"Hello **world**."` renders as `<p style="...">Hello <strong>world</strong>.</p>`.
- **Happy path: GFM pipe table (covers R1).** Input is a 3-column, 2-row table with header row. Output contains exactly one `<table>` with `border-collapse:collapse`, one `<thead>` with one `<tr>` containing 3 `<th>` elements with `background:#f5f5f5`, and one `<tbody>` with two `<tr>` elements containing 3 `<td>` elements each. No literal `|` characters in the rendered HTML.
- **Happy path: fenced code block.** Triple-backtick block with ` ```ts ` language hint renders as `<pre style="..."><code>...</code></pre>` with the language hint NOT appearing in the user-visible text. Backticks are absent from the rendered output.
- **Happy path: nested lists 2-level (covers R1).** A two-level ordered-inside-unordered list renders as `<ul>` containing `<li>` containing `<ol>` containing `<li>` — structural nesting preserved.
- **Happy path: nested lists 4-level (covers R1, guards renderer hardcoding).** A list nested 4 levels deep renders with semantic `<ul>`/`<ol>` nesting at every level — verifies the renderer override does not silently flatten beyond 2 levels.
- **Happy path: blockquote.** `"> quoted"` renders as `<blockquote style="border-left:3px solid ...">quoted</blockquote>`.
- **Happy path: heading hierarchy.** `#` through `######` render as `<h1>` through `<h6>` with descending font-size inline styles.
- **Happy path: mixed inline (R1).** A paragraph containing bold + italic + inline code + a link renders all four within a single `<p>`, each with the expected element and inline style.
- **Happy path: image (R3).** `![alt](url)` renders as `<img src="url" alt="alt" style="max-width:600px;...">`. No CID, no fetch.
- **Edge: empty input.** `renderForEmail("")` returns `{ html: "", text: "" }` (or an equivalent benign empty result) without throwing.
- **Edge: agent markdown contains a literal `<` or `>` (not a tag).** Renders as `&lt;` / `&gt;` in HTML, preserves literal characters in `text`.
- **Error path: link with `javascript:` URL (covers AE4 from origin).** `[click](javascript:alert(1))` renders such that the `<a>` element omits the `href` attribute (or sets it to a benign placeholder). The visible link text "click" remains. DOMPurify's `ALLOWED_URI_REGEXP` would also strip it, but the renderer-level check survives the text.
- **Error path: image with `data:` URL.** `![pixel](data:text/html,<script>alert(1)</script>)` renders such that the `<img>` element omits the `src` attribute (renderer-level reject) AND DOMPurify strips any residual `data:` URI per `ALLOWED_URI_REGEXP`.
- **Error path: agent emits raw `<script>alert(1)</script>` in markdown.** The output HTML does not contain a `<script>` tag. DOMPurify's `FORBID_TAGS: ['script']` strips it; the visible text remains as escaped content.
- **Error path: agent emits an `onclick=` attribute via raw HTML.** Sanitizer strips the event handler.
- **Error path: agent emits `<svg><use href="javascript:alert(1)" /></svg>`.** DOMPurify's `USE_PROFILES: { html: true }` + `FORBID_TAGS: ['svg']` strips the entire `<svg>` element including its namespace children. No SVG content reaches the output.
- **Error path: agent emits `<math><mtext><script>alert(1)</script></mtext></math>`.** Same protection — `FORBID_TAGS: ['math']` strips the entire MathML block.
- **Integration: `text` field equals input verbatim (covers R5).** For every corpus case, the returned `text` is exactly the input markdown string (no transformation).

**Verification:**
- `pnpm --filter @thinkwork/api test packages/api/src/lib/channel-rendering/__tests__/email-renderer.test.ts` passes.
- `pnpm --filter @thinkwork/api typecheck` clean.
- Manual sanity: copy one rendered HTML fragment into a `.html` file, open in a browser; visual contract matches the existing artifact-delivery email look.

---

### U2. Wire `thread-reply.ts` to multipart/alternative + call `renderForEmail`

**Goal:** Change `packages/api/src/lib/email/thread-reply.ts`'s SES send from single-part `text/plain` to `multipart/alternative` containing both the rendered HTML (via `renderForEmail(body).html`) and the raw markdown body as the `text/plain` part. All other headers — `From`, `To`, `Reply-To`, `Subject`, `Message-ID`, `In-Reply-To`, `References`, `X-Thinkwork-Reply-Token`, `MIME-Version` — are unchanged.

**Requirements:** R1 (consumer), R2 (consumer), R6, R10 (partial — thread-reply is one of the migration sites).

**Dependencies:** U1 (renderer exists and is tested).

**Files:**
- Modify: `packages/api/src/lib/email/thread-reply.ts` — replace lines 156-161 (single `Content-Type: text/plain` line plus `Content-Transfer-Encoding: 7bit` plus the body concat) with multipart construction.
- Create or extend: `packages/api/src/lib/email/__tests__/thread-reply.test.ts` — test for the SES `SendRawEmailCommand` payload shape (presence of `multipart/alternative`, boundary, both MIME parts, threading headers intact).

**Approach:**
- **Strip CRLF from interpolated header values first.** Before constructing the `rawHeaders` array, wrap every interpolated string (`subject`, `senderEmail`, `fromAddress`, `messageId`, normalized `originalMessageId`, `token`) in a `stripCRLF(value: string): string` helper that removes `\r`, `\n`, `\r\n`, and ` `/` ` line separators. This closes a pre-existing CRLF-injection gap that allows a crafted inbound-email Subject to inject `Bcc:` headers. Single-line helper, no library required.
- Replace the `Content-Type: text/plain` header line with `Content-Type: multipart/alternative; boundary="<boundary>"` where `<boundary>` is a random string per send (the existing `randomBytes` import in the file or `crypto.randomBytes` is fine).
- Build the body as:
  ```
  --<boundary>
  Content-Type: text/plain; charset=UTF-8
  Content-Transfer-Encoding: 7bit

  <renderForEmail(body).text>

  --<boundary>
  Content-Type: text/html; charset=UTF-8
  Content-Transfer-Encoding: 7bit

  <renderForEmail(body).html>

  --<boundary>--
  ```
- **Content-Transfer-Encoding: switch to `quoted-printable` for both parts.** The existing single-part `7bit` header is unsafe in this expanded scope: agent output regularly contains emoji and non-ASCII characters, and 7bit encoding prohibits high-bit octets and >998-char lines. SMTP relays can silently truncate violating lines, which produces a recipient render that differs from the sanitized output (a sanitization bypass surface). `quoted-printable` encodes non-ASCII safely without significant size overhead for typical agent prose. Use Node's `Buffer.from(s).toString('binary')` → quoted-printable encoder (or a single small helper) per part.
- Threading headers above the body block remain in their current order. `MIME-Version: 1.0` is already present at the current header set; keep it.
- The `body` field passed into `sendThreadReplyEmail` is unchanged — callers (currently only `chat-finalize/process-finalize.ts:411-422`) pass `responseText` as today.

**Technical design (directional, not implementation specification):**
```
// Pseudo-MIME body composition. Real implementation builds this with
// template literals + a generated boundary token + quoted-printable encoding.
const { html, text } = renderForEmail(input.body);
const boundary = "tw-boundary-" + randomBytes(16).toString("hex");

// Strip CRLF from every interpolated header value to close pre-existing
// header-injection gap. stripCRLF returns the input with \r, \n, \r\n
// removed (single line, no library).
const safeSubject = stripCRLF(subject);
const safeSender = stripCRLF(senderEmail);
const safeFrom = stripCRLF(fromAddress);
const safeMessageId = stripCRLF(messageId);
const safeToken = stripCRLF(token);
const safeRefs = originalMessageId ? stripCRLF(normalized) : "";

const rawHeaders = [
  `From: ${safeFrom}`,
  `To: ${safeSender}`,
  `Reply-To: ${safeFrom}`,
  `Subject: ${safeSubject}`,
  `Message-ID: ${safeMessageId}`,
  `MIME-Version: 1.0`,
  `X-Thinkwork-Reply-Token: ${safeToken}`,
  ...(safeRefs
    ? [`In-Reply-To: ${safeRefs}`, `References: ${safeRefs}`]
    : []),
  `Content-Type: multipart/alternative; boundary="${boundary}"`,
];

const body = [
  `--${boundary}`,
  `Content-Type: text/plain; charset=UTF-8`,
  `Content-Transfer-Encoding: quoted-printable`,
  ``,
  toQuotedPrintable(text),
  ``,
  `--${boundary}`,
  `Content-Type: text/html; charset=UTF-8`,
  `Content-Transfer-Encoding: quoted-printable`,
  ``,
  toQuotedPrintable(html),
  ``,
  `--${boundary}--`,
].join("\r\n");

const rawMessage = [...rawHeaders, "", body].join("\r\n");
```

This illustrates the intended approach and is directional guidance for review, not implementation specification.

**Execution note:** Add an integration test that constructs a sample input, captures the `SendRawEmailCommand`'s `RawMessage.Data` payload (via a SES client mock or test-seam), and asserts the MIME structure: header present, boundary delimiter appears 3 times (open, between parts, close with `--`), both parts have the expected `Content-Type`, threading headers are in the header block (not the body).

**Patterns to follow:**
- Existing `thread-reply.ts` header-array-then-join-with-CRLF pattern (lines 140-161). Keep that style for the new headers; build the body separately and concatenate with the same `\r\n` join.

**Test scenarios:**
- **Happy path: multipart structure.** Given a non-empty markdown body, the captured `RawMessage.Data` contains the literal `Content-Type: multipart/alternative; boundary=` header in the top header block, two part-headers (`text/plain` and `text/html`), and a closing `--<boundary>--` line.
- **Happy path: text part contains raw markdown.** The captured `text/plain` part body is exactly the input markdown.
- **Happy path: html part contains rendered HTML.** The captured `text/html` part body is the output of `renderForEmail(body).html` for that input.
- **Happy path: threading headers preserved (covers F1 — initial cold-contact delivery, and F2 — recipient-reply continuation).** `Message-ID`, `In-Reply-To`, `References`, `X-Thinkwork-Reply-Token` appear in the header block — not in the body — and have the same values they had pre-change for the same input.
- **Happy path: From/To/Reply-To/Subject unchanged.** Same values as the pre-change implementation for the same input.
- **Security: CRLF injection in Subject is stripped.** Input message metadata with `subjectFromMessage` containing `Test\r\nBcc: attacker@evil.com` produces a `Subject:` header line containing only `Re: TestBcc: attacker@evil.com` (literal text) — no second header line is injected, and `Bcc:` does not appear as a header key in the rendered raw message.
- **Security: CRLF injection in senderEmail is stripped.** Same protection applied to `senderEmail`, `originalMessageId`, and other interpolated values — `\r`, `\n`, `\r\n` removed before construction.
- **Edge: empty body.** Behavior matches existing — function returns `{ sent: false, skipReason: <whatever it was> }` OR sends an empty-body multipart (whichever the existing function does on empty input; preserve that behavior, do not introduce new short-circuits).
- **Edge: markdown with literal `--` sequence.** The MIME boundary token (`tw-boundary-<hex>`) is unique per send (random); a literal `--` in the body cannot collide. Verify boundary uniqueness by inspecting the generated token.
- **Edge: body containing emoji or other non-ASCII.** `toQuotedPrintable` encodes non-ASCII octets as `=XX` hex escapes; the encoded part body decodes back to the original Unicode content in a standards-compliant mail client. Assert round-trip: encode → decode → equals original.
- **Integration: reply-token persistence still happens.** The `emailReplyTokens` insert at lines 175-185 is unchanged. After the multipart send, the row exists with the same shape as today.

**Verification:**
- `pnpm --filter @thinkwork/api test packages/api/src/lib/email/__tests__/thread-reply.test.ts` passes.
- Manual on dev: re-trigger the original Opportunities email (or any inbound email to the dev tenant); confirm the inbox shows formatted HTML (table renders as a table, code as code) AND a plaintext fallback exists when toggling to "Show original" in Gmail.

---

### U3. Migrate `artifact-delivery.ts` email path + handle the PDF path + delete `markdown-render.ts`

**Goal:** Replace the email-targeted call sites in `packages/api/src/lib/artifact-delivery.ts` with `renderForEmail`. Handle the PDF-targeted call site (`renderPdfHtml`) by giving it its own minimal markdown-to-HTML helper. Delete `packages/api/src/lib/markdown-render.ts` once no callers remain. Achieve R10's "one markdown renderer for email" invariant without breaking PDF generation.

**Requirements:** R10.

**Dependencies:** U1.

**Files:**
- Modify: `packages/api/src/lib/artifact-delivery.ts` — replace imports + the email call sites at lines 76 and 78 (both inside `renderEmailDelivery`); rewrite the PDF call site at line 145 to use a local helper or direct `marked.parse()` call.
- Delete: `packages/api/src/lib/markdown-render.ts`.
- Delete or update: any test file for `markdown-render.ts` (none currently exist per local research).

**Approach:**
- Replace `import { markdownToHtml, wrapEmailHtml } from "./markdown-render.js";` with `import { renderForEmail } from "./channel-rendering/index.js";` (or whatever the final path resolves to).
- **Email path (lines 76 + 78, inside `renderEmailDelivery`).** The existing pattern wraps `markdownToHtml(artifact.content)` in `wrapEmailHtml(...)` to produce a full `<!DOCTYPE html>` document with white-card layout, preheader span, and centered 600px table. Two valid options:
  1. **Keep the document shell** (recommended). Retain a small `wrapEmailDocument(fragment, { title, preheader })` helper inside `artifact-delivery.ts` that wraps the fragment with the existing `<!DOCTYPE html>` + inline-styled container. `renderEmailDelivery` becomes `wrapEmailDocument(renderForEmail(artifact.content).html, { title, preheader })`. Preserves the artifact-email visual contract.
  2. **Ship the bare fragment.** Drop the document shell entirely; email clients render the fragment as-is inside the `text/html` part. Changes the visible artifact-email layout (no white card, no centered container). Only choose this if the visual change is explicitly acceptable.
  Default to option 1 unless the implementer has product approval to change the artifact-email look.
- **PDF path (line 145, inside `renderPdfHtml`).** `renderPdfHtml` already builds its own `<!DOCTYPE html>` + `<style>` block; only the markdown-to-HTML conversion needs replacement. Two valid options:
  1. **Inline a minimal helper** (recommended for ownership clarity). Copy the relevant markdown-to-HTML logic from `markdown-render.ts` into `artifact-delivery.ts` as a local `renderMarkdownToHtmlForPdf(markdown)` function. Adjust as needed for PDF (e.g., the `<style>` block in `renderPdfHtml` handles styling, so inline-style overrides are unnecessary).
  2. **Call `marked.parse()` directly.** `import { marked } from 'marked'` and call `marked.parse(artifact.content)` with default configuration. Style is handled by the `<style>` block in the surrounding HTML. Smaller code change but loses any defensive parsing the inlined helper would carry.
  Either is acceptable; choose based on the existing `markdown-render.ts` logic complexity at implementation time.
- **Sanitization parity for PDF.** PDF rendering also exposes XSS risk if the PDF viewer or downstream consumer ever opens the HTML in a browser. The PDF path's HTML output should run through DOMPurify before being passed to Puppeteer/wkhtmltopdf, using a config appropriate for PDF (likely the same `ALLOWED_URI_REGEXP: /^https?:/i`, but `FORBID_ATTR: ['style']` does NOT apply because PDF needs the `<style>` block to function — call out the config difference at implementation time).
- Once both email call sites are migrated AND the PDF path has its own markdown helper AND the test suite is green, delete `markdown-render.ts`. Final grep verifies zero matches outside the deletion-commit metadata.

**Execution note:** Run the artifact-delivery tests (if any exist) plus the new email-renderer tests to confirm no visual regression. If artifact-delivery lacks tests, add at least one snapshot test that pins the rendered output for a representative artifact body — same corpus item as U1's paragraph case is fine.

**Patterns to follow:**
- The `inert-first-seam-swap-multi-pr-pattern` — old module stays through U1 and U2, deleted only when no callers remain in U3. This unit is the seam swap's final commit.

**Test scenarios:**
- **Happy path: artifact email delivery still works.** Existing artifact email flow (Lambda handler or scheduled job) produces an email with the artifact's content rendered as HTML. The visible content matches the prior visual contract (white-card layout, preheader, centered container) under option 1; or the bare-fragment layout under option 2 with explicit product sign-off.
- **Happy path: artifact PDF generation still works.** `renderPdfHtml` produces a full `<!DOCTYPE html>` + `<style>` document with the markdown content converted to HTML inside the document body. Snapshot-pin the structure (presence of `<!DOCTYPE html>`, `<style>`, type-badge `<div>`, content `<h1>`/`<p>` etc.) to catch regressions.
- **Happy path: artifact email inherits GFM table support.** Any artifact whose body contains a markdown table now renders that table as HTML in the delivered email (side effect of the migration, not a separate feature).
- **Cleanup verification: no references to old module.** `rg 'markdown-render'` in `packages/` returns zero hits (excluding the deletion commit itself, which references the path in commit message). `rg 'markdownToHtml|wrapEmailHtml'` returns zero hits in code.
- **Cleanup verification: old test file removed.** If a `markdown-render.test.ts` existed (none currently), it's deleted.

**Verification:**
- `pnpm --filter @thinkwork/api test` passes (full suite, not just email tests — catches any callers I might have missed).
- `pnpm -r --if-present typecheck` clean (catches any remaining type references to the deleted module).
- `rg 'markdown-render|markdownToHtml|wrapEmailHtml' packages/api/src` returns zero hits.
- Manual: artifact delivery — if there's a simple way to fire it on dev (script, cron, or a test endpoint), do so and inspect the resulting email's body in Gmail.

---

## System-Wide Impact

| Surface | Impact |
| --- | --- |
| **Email recipients of agent replies** | Visible HTML rendering; tables render as tables, code as code. The screenshot's failure mode is fixed. Plaintext fallback preserved for accessibility tools and security gateways. |
| **Artifact delivery emails** | Same email shell, plus GFM table support inherited from the migration. Visual contract for the existing artifact corpus preserved. |
| **`packages/api` Lambda bundle size** | +1 `marked` dep (~30 KB minified) + 1 `isomorphic-dompurify` dep (~50 KB minified). Net ~80 KB addition vs deleted regex parser (~200 LOC). Within Lambda layer budgets; will be visible in the next `pnpm build:lambdas` summary. |
| **SES outbound** | Same `SendRawEmailCommand`, same threading-header path, same `email_reply_tokens` persistence. Only the MIME body shape changes. No new SES IAM permissions required. |
| **Agent prompt / output** | No change. The agent continues to emit markdown; the renderer is downstream of the agent. |
| **In-thread admin SPA rendering** | No change. The admin already renders the markdown response via `react-markdown` (different code path). |
| **Slack / Teams reply work (future)** | The `channel-rendering/` directory exists for them. Module shape and `index.ts` surface accept new `renderForSlack` / `renderForTeams` exports without refactor. |

---

## Risks & Dependencies

### Risks

- **R-R1: Visual regression in artifact delivery.** Switching artifact-delivery from the old renderer to the new one changes the rendered HTML in ways that may differ subtly from today's output (different `marked` token shapes, slightly different inline styles, different escaping behavior). **Mitigation:** the planning corpus from R11 is small and explicit; U3's verification includes manually inspecting a representative artifact email if possible. Worst case is small visual drift, not broken behavior.

- **R-R2: DOMPurify version pinning + future XSS vectors.** DOMPurify must stay current to catch new XSS vectors. **Mitigation:** semver-minor floor in package.json, Renovate/Dependabot keeps it current. The config pins in R12 close today's known surface (SVG/MathML namespaces, non-`https:` URIs, event handlers), but new bypass vectors will emerge — track DOMPurify security advisories.

- **R-R3: MIME boundary collision.** A random per-send boundary token (16 bytes of hex = 128 bits) makes collision with agent body content cryptographically negligible. **Mitigation:** the random-boundary pattern is standard; no special handling beyond using `crypto.randomBytes`.

- **R-R4: Multipart MIME parsing failure in an obscure client.** Some legacy mail clients (Lotus Notes, very old Outlook, text-mode Mutt without HTML support) may fail to render multipart/alternative. **Mitigation:** the plaintext fallback (R5) handles this — those clients show the raw markdown, which is still readable.

- **R-R5: Open-redirect / agent-controlled link content.** An agent that researches external sources may quote an attacker-controlled URL (training-data injection, prompt-injection via researched web content). The link reaches the email recipient with the Thinkwork brand attached. **Mitigation deferred:** v1 does not introduce a click-tracking or redirect-proxy layer; the agent's research path is the place to harden this. Track as a follow-up brainstorm topic when the threat model demands it.

- **R-R6: Remote-image tracking / pixel beacons.** External email recipients have no prior relationship with Thinkwork; loading a remote image from an agent-researched URL pings that third-party server with recipient IP + client metadata. **Mitigation:** recipient clients block remote images by default in most modern mail apps. v1 accepts this; if/when enterprise compliance requires server-side rewriting (proxy image URLs through a Thinkwork CDN), a separate brainstorm owns that scope.

- **R-R7: PDF rendering loses centralized markdown logic.** Once `markdown-render.ts` is deleted, the PDF path has its own inlined helper (or direct `marked.parse()` call). If a future markdown edge case requires renderer changes (e.g., a new GFM extension), the PDF path won't automatically inherit them. **Mitigation:** when the PDF path stabilizes around a small set of markdown idioms (artifacts are agent-authored prose, not arbitrary user input), drift is bounded. Re-converge if PDF and email visual specs grow closer.

### Dependencies

- **D-1: `marked` and `isomorphic-dompurify` available on npm.** Both are widely used and unlikely to disappear; pin to current stable at lockfile time.
- **D-2: SES production access enabled on dev** (resolved earlier in this session, 2026-05-24). No additional SES configuration required.
- **D-3: U1 must land before U2 and U3.** Strict dependency.
- **D-4: U2 and U3 can land in either order after U1.** Both call the new renderer; neither blocks the other. The natural sequence (U2 then U3) keeps the email-reply path's fix visible first and the cleanup last, but the implementer can adapt if test failures suggest otherwise.

---

## Documentation / Operational Notes

- **Post-merge verification:** trigger an inbound email to the dev tenant (e.g., re-send the original Opportunities email), confirm the reply renders as HTML with the table rendered correctly, and confirm the plaintext fallback exists in the source.
- **No docs site update required** in v1 — the channel-rendering module is internal, not a public API surface. When `renderForSlack` / `renderForTeams` ship, that's a docs candidate.
- **`docs/solutions/best-practices/` entry recommended** after this lands (per learnings-researcher's note). Topic: multipart/alternative wiring + `marked` renderer overrides + email-client inline-style invariants. Add via `/ce-compound` post-PR.

---

## Sources & References

- Origin: `docs/brainstorms/2026-05-24-agent-output-email-html-rendering-requirements.md` (this plan addresses all 12 R-IDs and 6 AE-IDs from that doc).
- Pattern: `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md` (shape pattern for "introduce module, migrate callers").
- Existing visual contract: `packages/api/src/lib/markdown-render.ts` (style values for tables, code, blockquotes, headings, code blocks — mirror these in the new renderer overrides).
- Existing send path: `packages/api/src/lib/email/thread-reply.ts:140-172` (header construction + SES SendRawEmailCommand).
- Existing non-thread-reply callers: `packages/api/src/lib/artifact-delivery.ts:76, 78` (`renderEmailDelivery`, email path — migrates) and `packages/api/src/lib/artifact-delivery.ts:145` (`renderPdfHtml`, PDF path — does NOT migrate, gets its own helper).
- `marked` documentation: https://marked.js.org/ (renderer override surface).
- `isomorphic-dompurify` on npm.
