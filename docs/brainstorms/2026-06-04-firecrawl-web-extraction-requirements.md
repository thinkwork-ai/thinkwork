---
date: 2026-06-04
topic: firecrawl-web-extraction
---

# Firecrawl Web Extraction

## Problem Frame

Thinkwork currently has Web Search for finding sources and Browser Automation for interacting with web pages. A recent research thread showed the gap between them: Exa found candidate pages, but page snippets were empty or thin; the agent then used Browser Automation to open a selected page, but Browser Automation returned screenshot/session metadata instead of clean page content. The agent paid the cost and complexity of a browser session without receiving the extracted knowledge it needed.

Firecrawl should fill this gap as a new built-in **Web Extraction** capability. It is not another search provider. It is the URL-to-content step after search has found a source and before browser automation is warranted.

---

## Actors

- A1. Tenant admin: configures the Firecrawl API key and enables or disables the tenant-level Web Extraction built-in.
- A2. Space user: asks an agent to research or read a known web page.
- A3. Agent runtime: chooses between Web Search, Web Extraction, and Browser Automation based on the task and available policy.
- A4. Agent/operator reviewer: inspects tool calls and expects extraction results to contain usable page content, not just browser session evidence.

---

## Key Flows

- F1. Configure Firecrawl for Web Extraction
  - **Trigger:** A tenant admin wants agents to read known URLs without relying on Browser Automation.
  - **Actors:** A1
  - **Steps:** The admin opens the Admin Built-in Tools surface, selects Web Extraction, enters a Firecrawl API key, tests the provider, and enables the built-in.
  - **Outcome:** Eligible agent turns can receive the Web Extraction tool when Space/template/runtime policy allows it.
  - **Covered by:** R1, R2, R3, R8

- F2. Agent reads a known URL
  - **Trigger:** A user asks an agent to analyze a specific page, or Web Search returns a URL worth reading.
  - **Actors:** A2, A3
  - **Steps:** The agent calls Web Extraction with the URL; Firecrawl returns clean page markdown or text plus source metadata; the agent uses that extracted content in its answer.
  - **Outcome:** The answer is grounded in page content rather than search-result snippets or screenshot metadata.
  - **Covered by:** R4, R5, R6, R7

- F3. Agent falls back to Browser Automation only when extraction is insufficient
  - **Trigger:** Web Extraction cannot access the content, or the task requires interaction such as clicking, form filling, authenticated state, or rendered UI inspection.
  - **Actors:** A2, A3, A4
  - **Steps:** The agent treats Web Extraction failure as a bounded failure; if Browser Automation is enabled and appropriate, it uses browser interaction as the next step.
  - **Outcome:** Browser Automation is preserved for interactive web work, not used as the default page-reading path.
  - **Covered by:** R6, R9, R10, R11

---

## Requirements

**Capability shape**

- R1. Firecrawl must be introduced as a separate credentialed built-in capability named **Web Extraction**, not as a provider under Web Search.
- R2. The runtime-facing tool should have a distinct extraction-oriented name such as `web_extract`, while the operator-facing label should be "Web Extraction".
- R3. Web Extraction must be configured at the tenant level in Admin only for v1: provider, API key, enabled state, and test result. Spaces must not expose API-key editing in v1.

**Single-page extraction**

- R4. v1 must optimize for one known URL at a time: "read this page and return clean content."
- R5. The tool output must include clean markdown or text, the source URL, title or page metadata when available, and a bounded indication of truncation or extraction failure.
- R6. The tool result must be useful to the agent as page knowledge. Returning only screenshots, byte counts, or browser/session metadata does not satisfy Web Extraction.
- R7. The tool must support both direct user-provided URLs and URLs discovered by Web Search.

**Policy and operator experience**

- R8. Web Extraction availability must follow the same built-in-tool governance model as other platform-owned tools: tenant credential/configuration gates the capability, and effective Space/template/runtime policy narrows whether an agent receives it.
- R9. Browser Automation must remain a separate policy-gated capability for interactive web tasks, not a substitute for single-page extraction.
- R10. Agents should prefer Web Extraction over Browser Automation when the user asks to read, summarize, analyze, or quote a public page that does not require interaction.
- R11. Browser Automation remains the fallback when extraction fails, page access requires interaction, or the requested task is inherently UI-operational.

**Agent guidance**

- R12. A companion web research/scraping skill or instruction layer should teach the orchestration sequence: use Web Search to find sources, Web Extraction to read known pages, and Browser Automation only for interaction or extraction failure.
- R13. The companion skill must not carry Firecrawl credentials or pretend to implement extraction itself. Credentialed extraction remains a platform-owned built-in.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R8.** Given a tenant admin has not configured Firecrawl, when a Space user asks an agent to read a URL, the agent does not receive Web Extraction and the tool surface does not imply that a Firecrawl key is available.
- AE2. **Covers R4, R5, R6.** Given Firecrawl is configured and enabled, when the agent calls Web Extraction for `https://example.com/page`, the tool returns clean page content and source metadata that the agent can cite or summarize.
- AE3. **Covers R7, R10.** Given Web Search returns a promising URL with an empty snippet, when the agent needs page details, it calls Web Extraction for that URL before considering Browser Automation.
- AE4. **Covers R9, R11.** Given a page requires clicking through a UI or depends on authenticated/session state, when Web Extraction cannot provide the needed content, the agent may use Browser Automation if policy allows it.
- AE5. **Covers R12, R13.** Given a web research skill exists, when an agent follows it, the skill guides tool choice but does not contain API keys or duplicate Firecrawl implementation details.

---

## Success Criteria

- A known-URL page-reading task no longer burns a browser session just to discover page text.
- Research answers that need page details are grounded in extracted content, not only search snippets or screenshot metadata.
- Operators can configure Firecrawl from Admin without expanding the v1 Spaces credential surface.
- Planning can implement Firecrawl without reopening whether it is search, extraction, browser automation, or a workspace skill.

---

## Scope Boundaries

- Site crawling, recursive docs ingestion, sitemap mapping, and multi-page research packs are out of scope for v1.
- Structured JSON extraction with user-provided schemas is out of scope for v1.
- Authenticated-page extraction, CAPTCHA handling, proxy configuration, and browser credential automation are out of scope for v1.
- Spaces API-key editing is out of scope for v1. Admin remains the credential configuration surface.
- Replacing Web Search is out of scope. Exa and SerpAPI remain discovery/ranking providers.
- Replacing Browser Automation is out of scope. Browser Automation remains the interactive web tool.

---

## Key Decisions

- **Firecrawl is extraction, not search.** Web Search finds candidate URLs; Web Extraction reads a known URL.
- **v1 is single-page extraction.** This directly fixes the observed thread failure without taking on crawl depth, structured extraction, or ingestion workflows.
- **Admin owns credentials for v1.** This avoids expanding the desktop/Spaces settings surface before the tool behavior is proven.
- **Use a companion skill for orchestration guidance.** The skill helps the agent choose Exa, Firecrawl, or Browser Automation, while the platform built-in owns credentials and execution.

---

## Dependencies / Assumptions

- Existing Web Search is already a credentialed built-in with provider/API-key/test behavior in Admin.
- Existing Spaces Built-in Tools settings currently expose list and enable/disable behavior, not provider/API-key editing.
- Existing Browser Automation can open a page and produce browser evidence, but it is not designed to return clean page markdown/text for simple reading tasks.
- Firecrawl can return page content in an agent-usable markdown or text form for public single-page URLs.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Confirm the final built-in slug and runtime tool name. Recommendation: `web-extract` for the built-in slug and `web_extract` for the runtime tool.
- [Affects R5][Technical] Define exact output limits, truncation markers, and metadata fields for extracted content.
- [Affects R8][Technical] Decide whether Space-level policy can enable/disable Web Extraction using the existing built-in tool policy model without adding credential editing.
- [Affects R12][Technical] Decide whether the companion guidance is best delivered as a workspace skill, system workspace default, or built-in runtime instructions.

---

## Next Steps

-> /ce-plan for structured implementation planning.
