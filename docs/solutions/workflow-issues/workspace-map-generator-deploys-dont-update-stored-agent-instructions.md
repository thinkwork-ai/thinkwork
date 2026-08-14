---
title: "Generator instruction changes do not propagate to agents on deploy — the stored INSTRUCTIONS.md is the baseline"
module: workspace-renderer
date: 2026-08-13
problem_type: workflow_issue
category: workflow-issues
component: assistant
severity: high
symptoms:
  - "Deployed change to workspace-map-generator.ts (PR #4279) yet fresh threads' AGENTS.md still carried the old Tool selection text"
  - "Behavioral test against a live agent failed after a full-stack deploy that included the instruction-text change"
  - "Patching an agent folder's INSTRUCTIONS.md in S3 had no effect because the tenant had multiple agent folders and the wrong one was edited"
applies_when:
  - "Changing any code that composes agent instruction text (workspace-map-generator.ts, workspace-renderer/compose-tuple.ts baseline inputs)"
  - "Expecting a code deploy to change what live agents receive in AGENTS.md"
  - "Verifying instruction changes on a customer stage after deploy"
  - "Hand-patching stored INSTRUCTIONS.md in S3 under tenants/<tenant>/agents/<slug>/"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - development_workflow
  - agentcore-pi-runtime
  - s3-tenant-storage
tags:
  - workspace-renderer
  - compose-tuple
  - agents-md
  - instructions-md
  - rendered-artifact-caching
  - deploy-propagation
  - agent-folders
  - s3
---

# Generator instruction changes do not propagate to agents on deploy — the stored INSTRUCTIONS.md is the baseline

## Context

During the McPherson brain-routing work (2026-08-13, PRs #4279 and #4280, both merged), a change to the agent Tool-selection instructions in `packages/api/src/lib/workspace-map-generator.ts` was full-stack deployed to a customer stage (canary.456). A fresh chat thread was expected to carry the new instructions — it did not. The thread's `AGENTS.md`, pulled from S3 seconds after thread creation, still contained the OLD text, and the behavioral test failed with no error anywhere in the pipeline. The root mechanism: per-thread `AGENTS.md` is composed at thread setup, but its agent-baseline section is *read* from the agent folder's stored `INSTRUCTIONS.md` object in S3 — it is not regenerated from generator code at thread time. A code deploy alone never touches that stored object.

## Guidance

### The propagation chain

Instruction text flows through five hops, and a deploy only updates hop 1:

1. **Generator code** — `packages/api/src/lib/workspace-map-generator.ts` owns the computed instruction sections. The Tool-selection text lives in `renderSkillsBody()` (`### Tool selection` is emitted at `workspace-map-generator.ts:1273`, with the bullet lines through ~1298), called from `renderSkillsSection()` (line 1263–1265) and assembled into named sections by `renderDerivedAgentsMdSections()` (line 1320+, which also produces "Folder Structure" and the other derived sections).
2. **Agent-workspace re-render** — the generator's output only lands in S3 when the agent workspace re-renders (blueprint repair, capability/skill change, or another render-triggering mutation). **A code deploy does not trigger a re-render.**
3. **Stored `tenants/<tenant>/agents/<slug>/INSTRUCTIONS.md`** — the durable agent-source baseline. The prefix is built by `agentWorkspacePrefix()` in `packages/api/src/lib/workspace-renderer/prefixes.ts:16-23` (`tenants/<tenantSlug>/agents/<agentSlug>/`).
4. **Thread compose baseline** — at thread setup, `compose-tuple.ts` reads that stored object as the baseline. The U16 dual-read at `packages/api/src/lib/workspace-renderer/compose-tuple.ts:1321-1331`:

   ```ts
   // U16 dual-read: the agent-source baseline moved to INSTRUCTIONS.md;
   // legacy AGENTS.md is the fallback for not-yet-migrated tenants. The
   // RENDERED artifact keeps the AGENTS.md name for now (Pi's hydrate
   // contract + prompt compose dual-read cover the window).
   objectStore
     .getText({ bucket, key: `${agentPrefix}INSTRUCTIONS.md` })
     .then((instructions) =>
       instructions !== null
         ? instructions
         : objectStore.getText({ bucket, key: `${agentPrefix}AGENTS.md` }),
     ),
   ```

5. **Per-thread `AGENTS.md` → Pi agent** — the composed artifact is written under the thread runtime prefix, built by `threadRuntimePrefix()` in `prefixes.ts:43-50` (`tenants/<tenantSlug>/threads/<threadSlug>/`), and that is what the Pi runtime hydrates and obeys.

So: **generator code → (re-render event) → stored `agents/<slug>/INSTRUCTIONS.md` → thread compose baseline → per-thread `AGENTS.md` → Pi agent.** The deploy updates only the first link; the agent behaves per the third.

### Making an instruction change take effect NOW

Verified live on 2026-08-13 (canary.456); the exact keys are code fact per the citations above, the procedure is session-proven:

1. **Identify the live agent folder.** A tenant can hold several agent folders — during this incident both `thinkwork-agent` and `thinkwork-agent-fd96fe3b9b01` existed under `tenants/<tenant>/agents/`. Patching the wrong one is a silent no-op. Identify the live folder by pulling a *fresh thread's* composed `AGENTS.md` from `tenants/<tenant>/threads/<slug>/AGENTS.md` and matching its baseline header content back to the candidate `INSTRUCTIONS.md` objects.
2. **Back up in place** — copy the stored `INSTRUCTIONS.md` to a `.backup-<date>` sibling key before touching it.
3. **Hand-patch byte-identical to generator output.** Produce the exact text the deployed generator would emit and overwrite the stored object with it. Byte-identical matters: the next legitimate re-render (blueprint repair, skill change) then rewrites the file to the same bytes — a no-op instead of a surprise diff or a regression back to old text.
4. **Verify with a fresh thread** — start a new chat thread and pull its `AGENTS.md` from the thread runtime prefix; confirm the new text is present (see Examples).

The merged generator change (#4279) is still required — it makes future re-renders converge on the same content rather than reverting the hand-patch.

## Why This Matters

- **Silent no-op deploys.** The deploy pipeline goes green, the Lambda ships the new code, and nothing observable changes in agent behavior. There is no error, no warning, no drift alarm — the stale stored object is a fully valid input to compose.
- **Behavioral tests fail with no error anywhere.** The only symptom is the agent doing the old thing. Without knowing the propagation chain, the natural (wrong) debugging targets are the deploy, the dispatcher, and the runtime image — all of which are fine.
- **Live-customer stakes.** This surfaced on a customer stage (canary.456). When an instruction fix is remediation for live agent misbehavior, "merged and deployed" is not "fixed" — the fix is inert until the stored baseline is updated.

## When to Apply

- Any change to generator-owned instruction text in `workspace-map-generator.ts` (Tool selection, Skills & Tools, Routing, Folder Structure — anything under `renderDerivedAgentsMdSections`) that must reach existing agents without waiting for their next re-render.
- Any "the deployed instruction change didn't take effect" symptom: fresh threads still show old text, behavioral tests fail post-deploy with no errors.
- The inverse trap too: **UI or hand edits to computed sections are equally lost** — the Skills & Tools / Routing / Folder Structure sections are recomposed from generator code on the next re-render, so editing them in the stored file (or any UI surface backed by it) is temporary at best.
- When patching, always confirm which of possibly-several agent folders under `tenants/<tenant>/agents/` is live before writing.

## Examples

Verification pattern (session-proven 2026-08-13):

```bash
# 1. Find candidate agent folders for the tenant
aws s3 ls s3://<workspace-bucket>/tenants/<tenant>/agents/

# 2. Back up the stored baseline before patching
aws s3 cp \
  s3://<bucket>/tenants/<tenant>/agents/<slug>/INSTRUCTIONS.md \
  s3://<bucket>/tenants/<tenant>/agents/<slug>/INSTRUCTIONS.md.backup-2026-08-13

# 3. Upload the hand-patched file (byte-identical to new generator output)
aws s3 cp /path/to/patched-INSTRUCTIONS.md \
  s3://<bucket>/tenants/<tenant>/agents/<slug>/INSTRUCTIONS.md

# 4. Start a fresh chat thread in the app, then pull its composed AGENTS.md
aws s3 cp \
  s3://<bucket>/tenants/<tenant>/threads/<thread-slug>/AGENTS.md - \
  | grep -n "distinctive phrase from the NEW instruction text"
```

- A grep hit on the new phrase in the fresh thread's `AGENTS.md` = the change is live end-to-end.
- No hit while the stored `INSTRUCTIONS.md` *does* contain it = you patched the wrong agent folder (check the other candidates).
- **Byte-identical rationale:** generate the patch text from the same deployed generator code path (not by eyeballing the diff), so that when a blueprint repair or skill change next re-renders the agent workspace, the renderer writes exactly the bytes already stored — the hand-patch and the code path stay converged, and the re-render is a no-op rather than a second behavior change.

References: PR #4279 (generator instruction change), PR #4280 (follow-up), both merged 2026-08-13. Code: `packages/api/src/lib/workspace-map-generator.ts:1263-1318` (Skills/Tool-selection body), `:1320+` (derived sections); `packages/api/src/lib/workspace-renderer/compose-tuple.ts:1321-1331` (U16 dual-read baseline); `packages/api/src/lib/workspace-renderer/prefixes.ts:16-23` (agent prefix), `:43-50` (thread runtime prefix).

## Related

- [Default skill content updates never reach agents](../integration-issues/default-skill-content-updates-never-reach-agents-seeder-allowlist-install-skip-deploy-supersession.md) — the sibling failure mode on the skill-catalog path: shipped content silently never reaching materialized workspaces.
- [Per-turn snapshot needs content-addressed immutable storage](../architecture-patterns/per-turn-snapshot-needs-content-addressed-immutable-storage.md) — same code locus (compose-tuple.ts); documents that the rendered AGENTS.md is overwritten only on re-render.
- [Eval template runs reused stale system agents](../logic-errors/eval-template-runs-reused-stale-system-agents-2026-05-17.md) — the same stale-state pattern from the eval entry point.
- [workspace-defaults md byte-parity needs a TS test](../workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md) — upstream byte-parity discipline that complements the byte-identical hand-patch rule here.
- [Workspace skills load from the copied agent workspace](../architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md) — the filesystem-truth principle that makes this non-propagation expected behavior, not a bug.
- The Pi runtime pins synced `agents/<slug>/INSTRUCTIONS.md` against a compiled etag (`packages/agentcore-pi/agent-container/src/runtime/manifest-agent-profiles.ts`) — runtime behavior is bound to the stored/synced file, consistent with this chain. (session history)
