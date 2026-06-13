---
date: 2026-06-13
topic: skill-tests-and-evals
---

# Skill Tests & Evals — Requirements

## Summary

Give every skill its own quality signal. A skill carries eval cases in its folder; on install/materialize they sync into a per-skill dataset and run in isolation — a baseline agent with only that skill installed — through the Evaluations Trust Core's replay→judge substrate, producing a score that is attributable to the skill and comparable across versions. Install and update surface that score and warn on regression, with an optional operator gate. A skill's eval set compounds from operator-flagged real-world failures, not just what its author imagined. The self-improving skill updater is a deferred follow-on.

---

## Problem Frame

The Evaluations Trust Core (THNK-2) made the platform agent's quality measurable and trustworthy. Skills — the installable capability units in the tenant skill catalog — have no equivalent. Installing or updating a skill is an act of faith: nothing tells an operator whether the new version is better or worse, and a regression only surfaces later as a bad thread. THNK-2's original ask named this directly: "find a way to include evals with our skills so they can be automatically tested," and skill repos already model the shape (tests bundled in the folder, e.g. EveryInc/compound-engineering-plugin `tests/`).

The substrate to do this now exists — per-tenant S3 eval datasets, the `pass | fail | error` verdict taxonomy, the ScoringEngine contract, replay→judge, read-only-MCP replay, and the flag→dataset loop. This work reuses all of it rather than inventing a parallel skill-test system; the new surface is small.

---

## Key Decisions

- **A skill eval is a dataset scoped to one skill.** Cases bundled in the skill folder sync into a per-skill eval dataset in the tenant's S3 namespace and run through the existing replay→judge substrate. No second assertion format, no separate scoring path — it reuses the trust-core dataset/verdict/engine contract. (This reframes the original "Evaluation Skill Category" idea: skill evals are a recognized *dataset source*, not a new skill type or category mechanism.)
- **Isolated execution for an attributable score.** A skill's cases run against a controlled baseline agent with only that skill installed (read-only MCP per the trust core). A verdict is then attributable to the skill itself — not confounded by the tenant's other skills or workspace — so the score means "this skill works" and is comparable across versions and tenants. Catching conflicts with a tenant's *other* skills is a deferred in-context check, not the canonical score.
- **Score + warn always; gate optional.** Install and update always compute and surface the skill's score and warn on regression versus the installed version. A hard block happens only when an operator opts into a gate/threshold — never by default, so eval failure can't silently pressure operators into shipping by disabling evals.
- **The eval set compounds from real usage.** A skill's dataset seeds from author-bundled cases and also accepts operator-flagged cases: when a flagged thread's bad turn is attributable to a skill, it can be added to that skill's dataset (reusing the THNK-2 flag→dataset loop). The skill's score gets more real over time instead of frozen at what the author anticipated.
- **Unrated is not failing.** A skill that ships no eval cases is "unrated," never blocked. The optional gate applies only to skills that have cases and tenants that opted in. Most existing skills start unrated; that must be a neutral state, not a regression.
- **The self-improving updater is deferred.** Eval-driven auto-research that proposes or applies skill improvements is a follow-on, gated on skill-eval signal being trusted first — the same substrate-before-the-loop sequencing that worked for the trust core.

---

## Requirements

**Authoring & discovery**

- R1. A skill folder may carry eval cases (prompt + resolution target/rubric, in the trust-core case format) in a bundled location within the skill.
- R2. On skill install/materialize, bundled cases are auto-discovered and synced into a per-skill eval dataset in the tenant's S3 namespace, indexed like other datasets.
- R3. A skill that ships no eval cases is "unrated" — a neutral state, never a failure or a block.

**Execution & scoring**

- R4. A skill's cases run in isolation: a baseline agent with only that skill installed, through the existing replay→judge substrate (read-only-MCP replay, `pass | fail | error` verdicts, errors excluded from the score).
- R5. A skill's score is the pass rate over its dataset's clean executions, tracked across skill versions so regression (a score drop vs the installed version) is detectable.
- R6. Skill evals run at install, at update, and on demand. (Continuous/scheduled and on-model-change runs are out of scope — see Scope Boundaries.)

**Install/update behavior**

- R7. Install and update always surface the skill's score and warn when the candidate version regresses against the installed version.
- R8. An operator may opt into a gate/threshold per tenant (or per skill) that blocks install/update below the threshold; absent an opt-in, evals never block.
- R9. Unrated skills are never gated, regardless of operator threshold settings.

**Compounding from usage**

- R10. An operator can attribute a flagged thread's bad turn to a specific skill and add it to that skill's eval dataset, via the existing flag→dataset flow extended with skill attribution.
- R11. The flag flow suggests the skills that were active/routed in that turn as attribution candidates; the operator confirms one (or selects "not skill-specific"). The system never auto-attributes without confirmation.

---

## Key Flows

- F1. Author bundles evals, operator installs
  - **Trigger:** A skill carrying bundled eval cases is installed/materialized for a tenant.
  - **Steps:** Cases sync into a per-skill dataset; an isolated run (baseline agent + this skill) scores it; the install surface shows the score.
  - **Outcome:** The skill arrives with a visible, attributable quality signal. **Covers R1, R2, R4, R5, R7.**

- F2. Update with regression warning (and optional gate)
  - **Trigger:** A skill update is offered/applied.
  - **Steps:** The candidate version's dataset runs isolated; its score is compared to the installed version; a regression warns. If the tenant opted into a gate and the score is below threshold, the update is blocked pending override.
  - **Outcome:** Operators see whether an update improves or regresses the skill before adopting it. **Covers R5, R6, R7, R8.**

- F3. Compound from a real failure
  - **Trigger:** A flagged thread's bad outcome is attributable to a skill.
  - **Steps:** The operator attributes the flagged case to that skill; it joins the skill's eval dataset; subsequent runs include it.
  - **Outcome:** The skill's eval set grows from real failures, raising the bar for future versions. **Covers R10.**

---

## Acceptance Examples

- AE1. **Covers R3, R9.** Given a skill with no eval cases, when it is installed under a tenant with a gate threshold set, it installs as "unrated" and is not blocked.
- AE2. **Covers R4, R5.** Given a skill with bundled cases, when its dataset runs, it executes against a baseline agent with only that skill installed and reports a pass rate over clean executions (errors excluded).
- AE3. **Covers R7, R8.** Given an update whose isolated score is below the installed version, when no gate is set the operator sees a regression warning and can proceed; when a gate is set below-threshold, the update is blocked until overridden.
- AE4. **Covers R10.** Given a flagged thread attributed to skill X, when the operator adds it to X's dataset, a subsequent run of X includes that case.

---

## Scope Boundaries

Deferred for later (sequenced, not rejected):

- The self-improving skill updater — eval-driven, auto-research → propose/apply skill improvements. The compounding loop that consumes skill-eval signal; build once that signal is trusted.
- Continuous/scheduled skill-eval regression runs and on-model-change auto-runs — v1 runs at install/update + on demand.
- In-context skill evals (against the tenant's real configured agent, to catch conflicts with other skills/workspace) — the isolated score is canonical; the in-context check is a later addition.

---

## Dependencies / Assumptions

- **Evaluations Trust Core (THNK-2)** is the substrate: per-tenant S3 datasets, `pass | fail | error` verdicts, ScoringEngine contract, replay→judge, read-only-MCP replay, flag→dataset loop. This work reuses it and does not modify the verdict taxonomy or engine contract.
- A **baseline agent** suitable for isolated skill runs is constructible — a minimal agent profile with one skill installed and nothing else. Whether such a baseline already exists or must be defined is a planning-time question.
- Skill-eval cases use the **same case format** as trust-core datasets (prompt, resolution target/rubric, optional deterministic assertions), so the judge and scoring apply unchanged.

---

## Outstanding Questions

**Deferred to planning**

- Where bundled eval cases physically live in the skill folder and how discovery reads them (file/dir convention) — implementation detail.
- How a skill's score and version-over-version trend surface in the skills UI vs the evaluations UI.
- Whether the gate threshold is configured per tenant, per skill, or both.
- How baseline-agent provisioning for isolated runs reuses or differs from the trust core's eval agent provisioning.

---

## Sources / Research

- Origin: THNK-2 (Evaluations Trust Core, shipped) — the dataset/verdict/engine/replay substrate this builds on; see `docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md` and `docs/brainstorms/2026-06-12-evaluations-trust-core-requirements.md`.
- Verdict taxonomy, replay write-safety, and the flag→dataset loop are documented in `docs/solutions/` (design-patterns, best-practices) and `CONCEPTS.md` (Evaluations section).
- Prior art the user cited: skill repos bundling tests in the folder (EveryInc/compound-engineering-plugin `tests/`).
- Skill catalog structure: tenant catalog at `tenants/<slug>/skill-catalog/<skill-slug>/`, materialized into workspace `skills/<slug>/`, wired by CONTEXT.md routing.
