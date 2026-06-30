---
date: 2026-06-30
topic: think-114-dynamic-pi-extensions
focus: Linear THINK-114 and Pi extension docs
mode: repo-grounded
linear: THINK-114
external:
  - https://pi.dev/docs/latest/extensions
---

# Ideation: THINK-114 Dynamic Pi Extensions

## Grounding Context

### Codebase Context

`THINK-114` asks whether ThinkWork's current Pi extensions are installed into the image or injected during invocation. The answer in today's code is mixed:

- The runtime already loads extension factories per invocation. `packages/pi-runtime-core/src/agent-loop.ts` passes `extensionFactories` into `DefaultResourceLoader`, and `packages/agentcore-pi/agent-container/src/server.ts` assembles an invocation-specific `ExtensionFactory[]` plus `extensionToolNames`.
- First-party ThinkWork extensions are still image-baked application code. `packages/agentcore-pi/agent-container/Dockerfile` copies `packages/pi-extensions/src/`, installs it, builds it, and the server imports extensions from `@thinkwork/pi-extensions`.
- The prior spike `docs/solutions/spikes/2026-05-29-pi-extension-loading-agentcore-spike.md` says programmatic `extensionFactories` are the right serverless mechanism and filesystem discovery is fallback only.
- `packages/pi-extensions/src/define-extension.ts` already has the authoring shape a dynamic system would need: `ThinkworkExtension`, `ProviderBundle`, `toolNames`, `defineExtension`, and `toExtensionFactory`.
- ThinkWork already supports hot-swappable workspace skills from `skills/<slug>/SKILL.md` and ephemeral pinned skills from S3, but those are instruction/tool-pack surfaces, not arbitrary TypeScript runtime extensions.
- Docs intentionally distinguish platform-owned built-ins, MCP servers, and workspace skills. Dynamic Pi extensions should not be smuggled into the skill surface without a separate trust and audit model.
- Mobile has a Pi-compatible extension subset, but it is Hermes-pure and cannot import the upstream Node SDK. Dynamic extension work needs runtime-target metadata so cloud-only extensions do not silently masquerade as portable.

### Past Learnings

- `docs/solutions/spikes/2026-05-29-pi-extension-loading-agentcore-spike.md` resolved that `extensionFactories` are the correct cloud mechanism for serverless loading.
- `docs/ideation/2026-06-18-thnk-21-pi-agent-goal-mode-ideation.md` repeats the crucial gotcha: extension tools must be folded into the Pi allowlist, or they register but never reach the model.
- `docs/src/content/docs/applications/admin/builtin-tools.mdx` documents the boundary between platform-owned runtime tool injection and workspace skills.
- `docs/src/content/docs/concepts/agents/skills.mdx` says skills are fresh on each invocation and are the right model for no-redeploy capability packs, but also says secrets and broad runtime behavior need separate handling.

### External Context

The Pi extension docs describe extensions as TypeScript modules that can register model-callable tools, subscribe to lifecycle events, block or modify tool calls, inject context, customize compaction, and add UI/commands in the local TUI. Pi auto-discovers extensions from global and project-local locations, supports `/reload`, and explicitly warns that extensions run with full system permissions, so only trusted sources should be installed.

That external model is useful but should not be copied literally into ThinkWork's AgentCore runtime. The repo has already chosen factory injection for serverless loading. The product question is therefore not "can we use Pi's local filesystem discovery?" but "how do tenant-authored or agent-authored TypeScript modules become trusted `ExtensionFactory[]` inputs on the next invocation?"

Source: [Pi Extensions docs](https://pi.dev/docs/latest/extensions)

## Ranked Ideas

### 1. Signed Dynamic Extension Artifact Pipeline

**Description:** Add a pipeline where uploaded extension source is validated, built in a controlled worker, signed, stored with a manifest, and loaded into AgentCore Pi as `ExtensionFactory[]` on eligible turns. Runtime should load signed artifacts, not compile arbitrary TypeScript during the user turn.

**Warrant:** `direct:` ThinkWork already passes per-invocation `extensionFactories` into `DefaultResourceLoader`, while the Dockerfile still bakes `packages/pi-extensions` into the image. `external:` Pi extensions are TypeScript modules, but Pi's docs warn they run with full system permissions.

**Rationale:** This directly answers the Linear issue: extension updates can become live without a new runtime image, while preserving the serverless mechanism already validated by the repo. Signing and prebuild also keep turn latency and supply-chain risk out of the hot path.

**Downsides:** Requires a build worker, artifact storage, signature verification, and a clear trust model before tenant code can run.

**Confidence:** 90%

**Complexity:** High

**Status:** Unexplored

### 2. Extension Manifest Plus Verification Harness

**Description:** Define an extension manifest, probably `extension.yaml`, with `name`, `version`, `toolNames`, event hooks, provider requirements, permission classes, dependency policy, runtime targets, and review provenance. Pair it with a verification harness that loads the candidate extension into a fake `ExtensionAPI`, records registered tools/events, compares actual registrations to manifest declarations, runs smoke prompts, and emits evidence.

**Warrant:** `direct:` `ThinkworkExtension.toolNames` already exists because extension tools omitted from the allowlist silently disappear. The prior spike says real tool-call proof is required, not just registration logs.

**Rationale:** Dynamic extension loading turns a convention into a product contract. A manifest and harness make upload failures explainable, prevent allowlist drift, and create reusable evidence for admin review, tests, and Linear/PR closeout.

**Downsides:** Manifest design can sprawl. The first version should stay narrow: tool names, events, providers, permissions, runtime target, dependencies, and artifact hash.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 3. Policy-Gated Extension Permission Model

**Description:** Treat dynamic extensions like browser extensions or policy-gated built-ins: every extension declares what it can observe and do, and Space/tenant policy decides whether those classes are allowed. Suggested classes: prompt-hook, read-only workspace, workspace-write, network, credentialed provider, user-interactive, child-model-call, background resource, and forbidden.

**Warrant:** `direct:` ThinkWork's Built-in Tools docs already separate credentialed and policy-gated runtime registrations. `external:` Pi warns that extensions run with full system permissions.

**Rationale:** An install switch is too coarse for arbitrary TypeScript. Permission classes give operators understandable review language and let the runtime block high-risk behavior before a turn starts.

**Downsides:** Static permission inference will be imperfect, so v1 should combine manifest declaration, conservative validation, and explicit operator acceptance rather than pretending to prove all behavior.

**Confidence:** 84%

**Complexity:** Medium-High

**Status:** Unexplored

### 4. Agent-Authored Extension Promotion Loop

**Description:** Let agents draft or improve extension source in a workspace folder, but route execution through review, build, verification, and signing. Use lifecycle lanes: agent-draft, tenant-reviewed, first-party-verified. Only reviewed/signed lanes can execute in normal turns.

**Warrant:** `direct:` `THINK-114` explicitly names agents improving existing extensions as a desired unlock, while current skill-draft guidance only persists `SKILL.md`-style workspace files. `reasoned:` executing agent-authored TypeScript directly is the riskiest possible first release, but drafting code for promotion preserves the self-improvement direction.

**Rationale:** This keeps the ambitious part of the issue without making unreviewed generated code executable. It also reuses the mental model of skill authoring while drawing a hard line between "drafted source" and "trusted runtime artifact."

**Downsides:** The loop has more states and UI than direct upload. It should likely follow the tenant-authored extension MVP rather than lead it.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

### 5. Pi Extension Catalog As A Third Capability Surface

**Description:** Add an admin catalog beside Skills Catalog and Built-in Tools for Pi Extensions: upload, validate, version, assign by Space/agent, pin, rollback, disable, and inspect load evidence. Explicitly model three capability surfaces: Skills for portable instructions/scripts, MCP for remote tools, and Pi Extensions for runtime hooks/provider-backed TypeScript.

**Warrant:** `direct:` Existing docs warn not to install built-ins as workspace skills and describe skills as `SKILL.md` packs. Pi extensions can intercept tool calls and lifecycle events, which is a different capability category.

**Rationale:** Naming the surface prevents architectural drift. Operators should not have to infer whether something powerful is a skill, a built-in, an MCP server, or an extension by reading implementation files.

**Downsides:** Adds another admin surface. The first version can be sparse if the pipeline and manifest are solid.

**Confidence:** 80%

**Complexity:** Medium

**Status:** Unexplored

### 6. Per-Turn Extension Bill Of Materials

**Description:** Record a bill of materials for each turn: loaded extension IDs, versions, source/artifact hashes, tool names, permission grants, provider grants, validation status, and load errors. Surface it in runtime evidence/logs and make it queryable for audit.

**Warrant:** `reasoned:` Enterprise audit needs replayable knowledge of which code was active for a turn. Current `extension_load_failed` logs are useful but not a tenant-facing, durable record of dynamic code provenance.

**Rationale:** Dynamic code is only acceptable if operators can answer "what code affected this turn?" later. This also helps debug the common failure mode where an extension was assigned but no tool appeared.

**Downsides:** Requires schema/API work or a structured evidence payload, and it must avoid leaking sensitive provider details.

**Confidence:** 78%

**Complexity:** Medium

**Status:** Unexplored

### 7. Next-Invocation Loading Contract With Provider-Owned State

**Description:** Define the cloud contract as "new extension version is available on the next invocation," not local Pi-style hot reload inside a running turn. Require extensions to externalize state through approved provider seams or platform APIs rather than module globals.

**Warrant:** `external:` Pi supports `/reload` for local extension directories and warns extension factories may run in invocations that never start a session. `direct:` ThinkWork skills already promise next-invocation freshness, and `ProviderBundle` exists so extensions call host-provided services instead of creating their own clients.

**Rationale:** Mid-turn hot reload makes audit, replay, and cost attribution harder. Next-invocation loading is compatible with AgentCore's serverless runtime and with ThinkWork's existing skill freshness semantics.

**Downsides:** It is less magical than Pi local `/reload`. Users may expect instant reload while testing, so a sandbox/dev mode may still be useful.

**Confidence:** 83%

**Complexity:** Low-Medium

**Status:** Unexplored

## Rejection Summary

| #   | Idea                                                  | Reason Rejected                                                                                                          |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Directly load arbitrary workspace `.ts` at invocation | Too risky without signing, permission gates, and audit.                                                                  |
| 2   | Compile TypeScript during every invocation            | Duplicates the stronger signed-artifact idea and puts latency/dependency failures in the hot path.                       |
| 3   | Treat dynamic extensions as advanced skills           | Misclassifies runtime code with lifecycle hooks as `SKILL.md` instruction packs.                                         |
| 4   | Ship agent-authored executable extensions first       | Correct north star, but highest-risk first release; better as a promotion loop after tenant-authored support.            |
| 5   | Reuse Pi filesystem discovery in AgentCore            | Prior repo spike already chose `extensionFactories` as the cloud mechanism.                                              |
| 6   | Hot reload inside a running cloud turn                | Weakens audit/replay and is unnecessary for the likely product contract.                                                 |
| 7   | First-party-only release ergonomics                   | Conservative fallback, but does not satisfy the main Linear request for injected extensions.                             |
| 8   | Full extension marketplace immediately                | Too large for `THINK-114`; useful as a long-term implication of the catalog.                                             |
| 9   | Extension DSL instead of TypeScript                   | Interesting safety variant, but it changes the subject away from Pi's actual TypeScript extension model.                 |
| 10  | Browser-extension permission prompts alone            | Useful UI analogy, but incomplete without build/sign/verify/runtime enforcement.                                         |
| 11  | Kubernetes-style admission controller alone           | Good process analogy, but absorbed into manifest plus signed artifact pipeline.                                          |
| 12  | Feature-flag rollout only                             | Operationally useful, but not foundational enough to rank above trust and loading mechanics.                             |
| 13  | Dependency SBOM as standalone idea                    | Important detail, but belongs inside the signed artifact pipeline.                                                       |
| 14  | Migration-style extension changelog                   | Useful versioning detail, but better handled as a manifest field.                                                        |
| 15  | Worker sandbox as MVP                                 | Strong long-term safety architecture, but too expensive for the first dynamic-loading tracer bullet.                     |
| 16  | Observe-only extension mode                           | Useful verification variant, but less central than the upload-time harness.                                              |
| 17  | Dynamic extensions unify all built-ins immediately    | Plausible long-term simplification, but risky as first release scope.                                                    |
| 18  | Mobile parity as a required MVP gate                  | Important metadata requirement, but not every cloud extension needs mobile execution in v1.                              |
| 19  | Per-Space assignment as standalone idea               | Kept implicitly in the catalog and policy model; not distinct enough as a survivor.                                      |
| 20  | Deterministic no-background-resource linter           | Good validation rule, but part of the verification harness and permission model.                                         |
| 21  | Reusable provider adapters as standalone idea         | Important implementation follow-through, but a dependency of the ranked ideas rather than a product direction by itself. |

## Suggested Brainstorm Seed

The strongest seed for `ce-brainstorm` is:

> Dynamic Pi extensions should be tenant-reviewed, signed TypeScript artifacts loaded into AgentCore Pi via the existing `extensionFactories` path on the next invocation, with manifests, policy-gated permissions, verification evidence, and a later agent-authored promotion loop.
