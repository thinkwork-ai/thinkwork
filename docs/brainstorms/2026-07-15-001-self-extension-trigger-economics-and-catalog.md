# Self-extension trigger economics, catalog-backed acquisition, and the skills convergence

**Date:** 2026-07-15
**Status:** brainstorm (post-live-drive findings)
**Related:** THINK-280 (governed capability runtime), self-extension arc (U1–U6 + #3792/#3793/#3796), `docs/plans` reactive-watching-swan

## What the live drives proved

Five instrumented live drives against the dev dogfood tenant (sleek-squirrel-230), watched
turn-by-turn at the DB (`thread_turn_events`, capability evidence tables):

1. **The machinery works.** All five capability Pi tools register in live chat sessions
   (verified by direct tool-inventory enumeration), the control Lambda actions work, and a
   chat-driven `routine_propose` produced a real machine-attributed proposal
   (`created_by_actor_type='agent'`, real Python, valid fingerprint) on the first
   post-#3792 drive.
2. **The loop is never chosen voluntarily.** Across drives the model dodged four different
   ways: (a) answered via ad-hoc `execute_code` + filed the proposal as an afterthought;
   (b) abandoned the loop after propose (never promoted); (c) delegated to the Research
   profile (whose child run does not carry capability tools); (d) with web tools
   policy-blocked, **fabricated** a plausible Hacker News top story from training memory
   rather than reach for the loop.
3. **Salience is not the fix.** In a thread where the model had _just enumerated its own
   capability tools_, a plain HN question still went: delegate → `execute_code` (open
   sandbox internet) → answer. Tools maximally salient; loop still lost.

## The core finding: it's economics, not awareness

The 5-step governed loop (search → research → admit → propose → promote → run) can never
out-compete a 1-call escape hatch. As long as the agent has **ungoverned code execution
with internet egress**, a rational model answers one-off questions the cheap way. Guidance
(TOOLS.md), in-result nudges (#3793), model upgrades (Haiku→Sonnet), and anti-delegation
instructions all failed for the same reason: they tax the cheap path's _description_, not
its _availability_.

Corollaries:

- **The trigger is the posture, not the prompt.** The loop triggers naturally only when
  the brokered capability path is the _only_ egress — i.e. the governed enterprise posture
  THINK-280 already designed (capability-private VPC interpreter, no raw egress). The
  dogfood agent's open sandbox makes the loop structurally unreachable for Q&A.
- **Fabrication is the failure mode of a closed posture without the loop.** When web tools
  were blocked and the loop wasn't taken, the model invented live data. Any governed
  posture rollout needs (a) an anti-fabrication guardrail for external data and (b) a
  dispatch-time signal pointing at the capability path (mirror the `withheld_connections`
  injection pattern: "web egress blocked by policy → use the governed capability path").
- **One-off Q&A is the wrong demand shape.** The loop's honest product framing is
  **commissioning**: "build me a reusable X capability" — automations, scheduled routines,
  workflow steps. There the 5-step cost is the point (durable, evidenced, revocable), not
  overhead.

## integrations.sh: the missing supply side

Eric's original interest in integrations.sh — a catalog of APIs / MCPs / CLIs with
connection instructions — is exactly the supply side this loop lacks:

1. **Research corpus.** `connection_research` today starts from raw official docs, from
   zero, every time. A curated catalog entry (endpoints, auth model, rate limits,
   descriptor skeleton) turns research into instantiation: faster, better descriptors,
   fewer rejected proposals.
2. **Pre-annotated risk tiers.** AUTO/REVIEW/FORBIDDEN classification is far more reliable
   read from a curated catalog (`public: true, readonly: true, credential: none`) than
   inferred from scraped docs. The classifier stays fail-closed; the catalog supplies
   evidence.
3. **Near-miss search.** The deepest UX gap: `capability_search` returning a dead miss
   gives the model nothing to grab. Search over a catalog turns a miss into a pull:
   "no admitted capability, but the catalog has `hackernews-firebase-api`
   (public read-only, auto-eligible) — admit it?" THINK-280 U8's external MCP search leg
   is the existing seam to slot a catalog source into.

## The skills/extensions/capabilities convergence

The platform now has three "agent extends itself" surfaces: skills (trust-gated content +
code), Pi extensions (platform tool code), and capability routines (governed external
connections). Overlap is real. The differentiator of the capability path is the
**governance property** (brokered egress, contract pinning, evidence rows, revoke,
risk-tiered review) — a property of the _substrate_, not the authoring loop. Direction
worth debating: self-extension becomes the governed **back-end** for any external-facing
ability an agent acquires; skills/extensions route through it whenever they need egress.
One acquisition story, one governance surface, artifact type as implementation detail.

## Candidate next units (not yet committed)

- **U-a: Dispatch-time governed-posture note** — when web/browser tools are policy-blocked
  and the agent is capability-enabled, inject a per-turn context note naming the
  capability path (mirror `withheld_connections`). Deterministic; pairs with an
  anti-fabrication guardrail line.
- **U-b: Delegation-aware capability tools** — thread the capability tools + caller
  context (`actor: "delegation"`, already in the wire contract) into agent-profile child
  runs via `childToolSurface()`; revert the v37 "never delegate" TOOLS.md line (wrong
  direction — delegation is a core capability).
- **U-c: Catalog-backed acquisition spike** — a small curated catalog (start: HN, GitHub,
  public REST classics) as a `connection_research`/`capability_search` source; evaluate
  integrations.sh's data as seed corpus.
- **U-d: Commissioning UX** — surface "teach the agent a capability" as an explicit
  operator/user action (button/skill), since commissioning, not Q&A, is the demand shape.

## Open questions

- Does the governed posture (no sandbox egress) become a per-tenant/per-agent Terraform
  mode, and what breaks when the ordinary interpreter loses internet?
- Where does the catalog live (S3 per-tenant like skill catalogs? platform-global with
  tenant overlays?) and who curates entries / their risk annotations?
- Does the REVIEW tier need a "commissioned by user" fast path (requester approval vs
  operator approval)?
