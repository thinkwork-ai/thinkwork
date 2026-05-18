---
date: 2026-05-14
topic: oss-symphony-and-connectors-retirement
---

# OSS Symphony And Connectors Retirement

## Problem Frame

Thinkwork is moving toward market release as a limited preview with a first paying customer coming online. The open-source repo should present a clean, intentional core agent harness rather than exposing Symphony or the connector runtime that was built primarily to prove Symphony.

The current connector model originated from the standalone Symphony work and was later generalized inside Thinkwork. It now carries too much behavior, schema, admin surface, and reliability expectation for an OSS platform primitive that has not been independently proven. Symphony should become a private enterprise extension with its own runtime, admin module, domain tables, and installation path. OSS Thinkwork should retain stable core primitives and OAuth/integration foundations, but not a shared connector runtime.

---

## Actors

- A1. Thinkwork operator: prepares the limited-preview product and wants OSS Thinkwork to feel coherent, supportable, and not overpromised.
- A2. Limited-preview customer: installs or evaluates Thinkwork and should not see unfinished Symphony or connector surfaces.
- A3. Enterprise extension customer: may receive Symphony as a paid/private module installed into the same AWS account and surfaced natively in admin.
- A4. Future implementer: needs a clear retirement boundary so cleanup does not accidentally remove OAuth, Skills, or Workflows.

---

## Key Flows

- F1. OSS limited-preview install
  - **Trigger:** A customer installs or evaluates OSS Thinkwork.
  - **Actors:** A1, A2
  - **Steps:** The customer deploys Thinkwork, opens admin and Computer surfaces, and sees core Computers, Threads, Skills, Workflows, OAuth/integration foundations, and other stable OSS features.
  - **Outcome:** No Symphony route, connector runtime, connector catalog, connector execution table, or connector-specific docs are visible or promised.
  - **Covered by:** R1, R2, R3, R5

- F2. Private Symphony install
  - **Trigger:** A paying enterprise customer receives Symphony.
  - **Actors:** A1, A3
  - **Steps:** A private Symphony extension installs its own AWS resources, runtime, domain tables, and admin module into the customer environment through a supported extension path.
  - **Outcome:** Symphony feels native to Thinkwork admin but is not implemented as an OSS connector row or OSS connector runtime.
  - **Covered by:** R4, R8, R9

- F3. Future Computer-level integrations
  - **Trigger:** Thinkwork revisits Slack, Google, GitHub, or similar Computer-level capabilities.
  - **Actors:** A1, A4
  - **Steps:** The product uses OAuth/provider credentials and capability bindings at the Computer/user level, closer to mobile Integrations/MCP Connect, rather than reviving the shared connector runtime.
  - **Outcome:** Integrations are credentials and capabilities a Computer can use, not admin-managed connector runtimes.
  - **Covered by:** R6, R7

---

## Requirements

**OSS Product Surface**
- R1. OSS Thinkwork must not expose Symphony as an admin route, sidebar item, documentation path, runbook, guide, or public roadmap item.
- R2. OSS Thinkwork must not expose a shared connector admin/runtime product surface, including connector setup, connector execution visibility, manual connector runs, connector lifecycle docs, or connector catalog UI.
- R3. The Computer Customize surface must remove the Connectors tab and any connector enable/disable behavior for limited preview.
- R4. Skills and Workflows customization must remain in scope unless planning discovers a direct dependency that makes connector removal unsafe; connector removal should not be used as a reason to remove those surfaces.

**Data And API Retirement**
- R5. The connector data model must be fully retired from OSS, including connector configuration records, connector execution records, and connector catalog records.
- R6. OAuth/provider credential primitives must remain. This includes provider registration, user/tenant connections, credentials, token refresh, MCP OAuth, and related runtime token resolution needed for Computer-level integrations.
- R7. Future Slack, Google, GitHub, and similar integrations should be modeled as Computer/user-level capabilities backed by OAuth or MCP credentials, not as rows in a shared connector runtime.

**Private Extension Boundary**
- R8. Symphony must move to a private extension model that owns its runtime, provider adapters, writeback behavior, run lifecycle, admin module, documentation, customer install path, and domain tables.
- R9. The OSS host should eventually expose explicit extension mount points and entitlement primitives, but the connector framework should not be preserved as the extension model.

**Preview Reliability**
- R10. The cleanup must prefer removing flaky or under-proven surfaces over preserving speculative generality.
- R11. The cleanup must include documentation and generated-schema sweeps so limited-preview users do not encounter dead links, stale GraphQL types, or references to retired connector behavior.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a limited-preview user opens the admin app, when they scan the sidebar and docs, they do not see Symphony or connector-run management.
- AE2. **Covers R3, R4.** Given a Computer user opens Customize, when connector cleanup has shipped, Skills and Workflows remain available but Connectors is absent.
- AE3. **Covers R5, R6.** Given cleanup has shipped, when the database schema is inspected, connector tables/catalogs are removed while OAuth connection and credential tables remain.
- AE4. **Covers R8, R9.** Given a paying customer receives Symphony later, when it is installed, its runtime and admin UI come from the private extension rather than OSS connector rows.

---

## Success Criteria

- OSS Thinkwork reads as a focused limited-preview core product, not a bundle of half-generalized enterprise modules.
- Symphony is clearly positioned as a private premium/enterprise extension.
- Planning can produce a cleanup plan without inventing whether connectors are being hidden, frozen, or fully removed: they are fully removed from OSS.
- OAuth-backed integrations remain available as a future Computer capability lane.

---

## Scope Boundaries

- Remove Symphony and OSS connectors fully, including schema, API, UI, docs, runtime, tests, generated types, and catalog surfaces.
- Preserve OAuth, credentials, MCP token, Skills, Workflows, Computers, Threads, and core agent harness behavior.
- Do not rebuild Computer-level integrations during the retirement cleanup.
- Do not design the full private extension marketplace in this cleanup. Only avoid preserving the connector model as that marketplace.
- Do not delete the standalone/private Symphony work; it is a source for the future enterprise extension.

---

## Key Decisions

- Full schema removal, not product hiding: Leaving unused connector tables would keep the wrong abstraction alive.
- Connector framework is not the extension model: It was Symphony-shaped and too behavior-heavy for OSS.
- Computer integrations will be revisited separately: The likely future shape is OAuth-backed Computer capabilities similar to mobile Integrations/MCP Connect.
- Symphony owns runtime plus UI privately: Premium extensions should bring their native admin module and backend/runtime while using stable OSS host primitives.
- GitHub should be the default future Symphony tracker path: Existing Linear work should be preserved privately where useful, but it should not define OSS Thinkwork.

---

## Dependencies / Assumptions

- The current connector data model was verified as originating from Symphony plans and first proving `linear_tracker` behavior.
- Current OAuth integration primitives are distinct from the connector runtime and should survive cleanup.
- The limited-preview customer does not require OSS connector runtime behavior.
- A private Symphony extension can initially move faster than a generalized extension marketplace.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5][Technical] Which forward migration sequence safely drops connector tables and connector-catalog tables in deployed environments?
- [Affects R11][Technical] Which generated GraphQL artifacts and route trees need regeneration after connector/Symphony removal?
- [Affects R6][Technical] Which docs currently use "connector" to mean OAuth/MCP integration rather than the retired connector runtime, and should be renamed instead of deleted?
- [Affects R4][Technical] Does any Workflows or Skills customization code depend on connector catalog helpers that should be split before deletion?

---

## Next Steps

-> /ce-plan for structured implementation planning.
