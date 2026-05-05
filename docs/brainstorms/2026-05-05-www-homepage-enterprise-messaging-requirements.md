---
date: 2026-05-05
topic: www-homepage-enterprise-messaging
---

# Homepage Enterprise Messaging — Remaining Cleanup

## Summary

Remove the four developer-facing sections from the homepage, replace the header's Docs/GitHub links with a "Request a demo" CTA, and add the "Built for the companies that built America" tagline to the footer — completing the shift to enterprise/IT-leader positioning started in this session.

---

## Problem Frame

ThinkWork's homepage was built for developers and open-source operators: CLI quickstart commands, primitives documentation, agent template configuration, and mobile app detail. The product positioning has shifted to enterprise IT leaders worried about Shadow AI — uncontrolled agent sprawl, unbudgeted token costs, and missing audit trails. The copy was updated in this session, but four developer-facing sections remain on the page, and the header and footer still signal the old open-source audience. Visitors who land from enterprise channels encounter messaging that matches the new positioning, then hit a CLI quickstart block or a GitHub icon that redirects them.

---

## Requirements

**Homepage sections**

- R1. Remove the HowItWorks section (four primitives: Threads, Memory, Sandbox, Controls) from the homepage.
- R2. Remove the AgentTemplates section from the homepage.
- R3. Remove the MobileApp section from the homepage.
- R4. Remove the QuickStart section (CLI commands) from the homepage.

**Header**

- R5. Remove the Docs link and GitHub icon from the header navigation.
- R6. Add a "Request a demo" button as the header's primary CTA, linking to `mailto:hello@thinkwork.ai?subject=ThinkWork demo request`.

**Footer**

- R7. Replace the current footer tagline with "Built for the companies that built America."

---

## Success Criteria

- A visitor landing on the homepage sees no CLI commands, no mobile app screenshots, and no GitHub or Docs navigation links.
- Every visible CTA on the homepage is oriented toward enterprise contact (demo request, talk to team) rather than developer self-service.
- The footer tagline signals the industrial market focus.

---

## Scope Boundaries

- Visual design changes (typography, color palette, red/amber accent system from the reference HTML) — not in this pass.
- Updating `/cloud` or `/services` page copy to match the new positioning — separate effort.
- A dedicated demo request landing page or contact form — separate effort.
- ProofStrip component copy updates.

---

## Key Decisions

- **Keep Audit and AdoptionJourney**: Both sections are enterprise-relevant — Audit speaks directly to compliance buyers; AdoptionJourney's "Crawl. Walk. Run." framing is IT-leader language, not developer language. Both stay.
- **Keep current brand-blue visual design**: The reference HTML's editorial aesthetic (Syne font, red/amber accents) is deferred. This pass is copy and structure only.
- **Header CTA is "Request a demo"**: Replaces both the Docs text link and the GitHub icon — the header should have one CTA, and it should be enterprise-facing.
- **Footer tagline replaces, not appends**: "Built for the companies that built America" replaces the existing tagline rather than sitting alongside it.
