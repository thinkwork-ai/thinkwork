---
title: "feat: Pi-style extension seam for the mobile harness + MCP tools as the first extension"
type: feat
status: active
date: 2026-05-30
depth: standard
---

# feat: Pi-style extension seam for the mobile harness + MCP tools as the first extension

## Summary

The on-device mobile harness (`apps/mobile/lib/agent/`) is Pi-shaped in its **loop** (`createAgentSession` / `prompt` / `subscribe` / flat `defineTool` tools / `ModelProvider` seam) but is missing Pi's defining **customization** characteristic: **extensions**. Cloud/desktop already adopted this — `@thinkwork/pi-extensions` ships `defineExtension({ name, register(pi, providers) })`, memory was its first capability (#1843/#1852/#1854), and system-prompt contribution flows through the `before_agent_start` event (#1847). This plan gives the mobile harness the same mental model so capabilities are *composed in as extensions*, not imperatively bolted onto `runThreadHarnessTurn`.

This plan:

1. Adds a **Pi-style extension seam** to the mobile harness (pi-hermes): a Hermes-pure mirror of Pi's `ExtensionAPI` (event bus + `registerTool`) + a `defineExtension` authoring helper, loaded by `createAgentSession`.
2. Ships **MCP tools as the first extension** (mirroring how memory was cloud's first), backed by a new server-side MCP proxy for tenant-scoped, idToken-authed tool discovery + execution.
3. Adds **image input** through the thread composer (a host concern, not an extension) so the agent can read a photo and call a tool with it (business-card → CRM story).

The harness stays tiny — the extension seam is small and the loop is unchanged. Pi's built-in tools stay enabled; extensions are additive (`[[project_pi_leverage_builtin_tools]]`).

**Extraction note (decided):** the mobile harness stays in `apps/mobile/lib/agent/` for now and is extracted to a standalone `packages/pi-hermes` (own repo later, plausibly) **once a second extension proves the API** — not on this first one. The extension API *is* the eventual package's public boundary, so we define it cleanly here. See `[[project_pi_extensions_architecture]]`.

---

## Problem Frame

`runThreadHarnessTurn` builds a turn with `buildTurnContext({ agentName, tools })` and every caller passes `tools: undefined`. To add a capability today you'd thread tools imperatively through that function — which diverges from how cloud customizes (extensions) and accretes capability-specific wiring into the loop. The faithful-to-Pi fix is an extension seam.

Three things the codebase lacks:

- **An extension seam in the mobile harness.** Cloud has one (`@thinkwork/pi-extensions` over the real Pi `ExtensionAPI`). Mobile has none. Mobile cannot reuse the cloud package: it depends on `@earendil-works/pi-coding-agent` (native addon, Node ≥22.19) and `@thinkwork/pi-runtime-core` (Node) — exactly what can't run in Hermes (spike `docs/solutions/spikes/2026-05-29-mobile-embedded-node-pi-spike.md`). So mobile needs its own minimal, Hermes-pure mirror of the same shape.
- **Tenant-scoped, per-user tool access on device.** `apps/mobile/lib/mcp-client.ts` uses a static shared bearer (`EXPO_PUBLIC_MCP_AUTH_TOKEN`), has no `tools/list`, and isn't tenant-scoped — it can't discover *which* tools a user's tenant exposes nor act as that user.
- **Image attachment in the thread composer.** `pickImage` and the multimodal `session.prompt(input, images)` path exist, but the composer has no attach affordance and `runThreadHarnessTurn` drops images.

### Scope Boundaries

- **In scope:** Hermes-pure extension seam (`ExtensionAPI` mirror with event bus + `registerTool` + `defineExtension` + extension-loading in `createAgentSession`); server-side MCP proxy (`tools/list` + `tools/call`, idToken auth, tenant resolution); MCP tools packaged as the first extension and wired into the thread turn; image input via the composer flowing into the turn as model-vision; live sim verification.
- **Deferred to Follow-Up Work:**
  - **Extract `packages/pi-hermes`** — after a second extension proves the API (decided trigger).
  - A second extension (memory mirror, or native device-capability tools) — needed to validate the API for extraction, but out of this plan's scope.
  - Full per-agent tool-policy parity with cloud (allowlists, per-agent narrowing) — `platformConfig` stays the seam.
  - Response streaming.
  - New server-side CRM tooling — validate against whatever MCP tools the tenant already exposes.
- **Outside this product's identity:**
  - Importing/sharing the cloud `@thinkwork/pi-extensions` runtime into mobile — it's Node/native; mobile mirrors the *shape*, never the runtime.
  - Image → tool **binary** passing — images go to the model (vision); tools get text args the model extracts.

---

## Key Technical Decisions

### KTD1 — pi-hermes mirrors Pi's extension shape, but owns its types (no cloud-package import)

The mobile harness gets its own `ExtensionAPI`, `Extension`/`ExtensionFactory`, and `defineExtension`, mirroring `@earendil-works/pi-coding-agent`'s extension surface and `@thinkwork/pi-extensions`'s `defineExtension({ name, register(pi, providers) })` authoring shape. It does **not** import either package — both are Node-only/native. Same mental model and authoring ergonomics across hosts; separate, Hermes-pure runtime.

### KTD2 — Mobile `ExtensionAPI` = event bus + `registerTool`; system prompt via `before_agent_start`

**Verified against the real Pi `ExtensionAPI`** (`@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`): it is `ExtensionContext & ExtensionContextActions` — the context provides `on(event, handler)` over a large `ExtensionEvent` union plus `logger`; the actions provide `registerTool(tool)`, `registerCommand`, etc. There is **no `contributeSystemPrompt` method**: system-prompt contribution flows through the **`before_agent_start` event**, whose handler receives `BeforeAgentStartEvent { systemPrompt: string, ... }` and returns `BeforeAgentStartEventResult { systemPrompt?: string }` (this is exactly cloud PR #1847). The cloud memory extension also uses `on("session_start")` + `on("context")` to inject grounding.

**Decision (user-confirmed): implement the full event system, not just a single hook.** The event bus is what makes this an extension framework rather than a tool-bundle, and it is the public boundary we extract to `packages/pi-hermes` later.

pi-hermes mirrors the **portable subset**:
- `registerTool(tool) => () => void` (returns an unregister fn)
- `on<E>(type, handler) => () => void` — a real event bus over a Pi-named event union. v1 dispatches `before_agent_start` (system prompt) from the loop; other events (`tool_call`/`before_tool_call`/`after_tool_call`, `agent_start`/`agent_end`, etc.) are part of the typed surface and stored, with loop dispatch added as real consumers arrive. Mirror Pi's event-type names verbatim for portability.
- `logger`

**Drop** (host-specific, meaningless in Hermes): `registerCommand` (CLI slash commands), `registerShortcut`/`keybindings`, `ui`, terminal/session-tree/exec actions.

### KTD3 — `createAgentSession({ extensions })` loads extensions; tools + prompt are composed, not passed

`createAgentSession` accepts `extensions: ExtensionFactory[]`, runs each `register(api)` once at session start against a concrete `ExtensionAPI` impl (an event bus + tool registry), collects contributed tools, and — by dispatching `before_agent_start` — composes the system prompt. `buildTurnContext` stays the base-identity assembler; extension contributions layer on top. Built-ins are never disabled (`[[project_pi_leverage_builtin_tools]]`).

### KTD4 — Server-side MCP proxy, not the existing device client

Mirror the `model-converse` proxy: a new HTTP handler exposes `tools/list` + `tools/call`, authenticates the caller's Cognito idToken, resolves the tenant (email fallback for Google-federated users, `[[feedback_oauth_tenant_resolver]]`), and forwards to the tenant's MCP server. The existing `mcp-client.ts` (shared static bearer, no `tools/list`) can't do tenant-scoped per-user discovery; the proxy keeps auth + tenant resolution server-side with no long-lived secret on device — consistent with `model-converse`.

### KTD5 — Image is a host concern, not an extension

Image attachment lives in the composer + `session.prompt(userText, images)`, serialized as Converse image blocks (already supported by `converse-mapping`). It is **not** modeled as an extension — forcing it into the extension API would be the over-abstraction we're explicitly avoiding. The model reads the image (vision) and calls a text-arg tool; that tool may well come from the MCP extension.

---

## High-Level Technical Design

```
 pi-hermes extension seam (NEW, Hermes-pure mirror of Pi):
   defineExtension({ name, description, register(pi) }) ─▶ ExtensionFactory
   ExtensionAPI: registerTool(tool)=>off · on(event,handler)=>off · logger
   system prompt: extension handles before_agent_start, returns { systemPrompt }

 createAgentSession({ systemPrompt, tools, extensions })
   │  for each extension: register(api)  ──▶ collect tools + event handlers
   │  dispatch before_agent_start  ──▶ compose final system prompt
   │  merge: built-ins + tools + extension tools
   ▼
 runThreadHarnessTurn(thread-turn.ts)
   │  extensions = [ mcpToolsExtension(idToken) ]      ◀── FIRST extension
   │  session.prompt(userText, images)                 ◀── images = host concern (composer)
   │     each loop step ─▶ POST /api/model/converse (tool specs + image blocks)
   │     model toolCall ─▶ tool.execute ─▶ POST /api/mcp/tools/call  (proxy → tenant MCP)
   │  recordTurn(...) persists the pair
   ▼
 normal message query + subscription renders the turn

 mcpToolsExtension = defineExtension({
   name: "mcp-tools",
   register: async (pi) => {
     const defs = await listTenantTools(idToken)        // POST /api/mcp/tools/list
     for (const d of defs) pi.registerTool(createMcpTool(d, proxyCall(idToken)))
     pi.on("before_agent_start", (e) => ({
       systemPrompt: e.systemPrompt + "\n\nYou can call your team's connected tools …",
     }))
   }
 })
```

Two new server routes (`/api/mcp/tools/list`, `/api/mcp/tools/call`); everything else reuses existing harness primitives (`createMcpTool`, `pickImage`, `ImagePart`, `session.prompt(images)`, `converse-mapping`).

---

## Implementation Units

### U1. pi-hermes extension seam (ExtensionAPI mirror: event bus + registerTool + defineExtension + loader)

**Goal:** A Hermes-pure extension mechanism mirroring Pi's `ExtensionAPI`, loaded by `createAgentSession`.

**Requirements:** Extension seam; faithful Pi shape (event bus + registerTool); built-ins preserved.

**Dependencies:** none.

**Files:**
- `apps/mobile/lib/agent/extensions/types.ts` (create — `ExtensionAPI`, the `ExtensionEvent` map (Pi-named: at least `before_agent_start` with its event+result shape, plus `tool_call`/`agent_start`/`agent_end` as typed members), `ExtensionHandler`, `Extension`, `ExtensionFactory`, `Logger`)
- `apps/mobile/lib/agent/extensions/define-extension.ts` (create — `defineExtension({ name, description, register })` → validated factory; mirror `packages/pi-extensions/src/define-extension.ts`)
- `apps/mobile/lib/agent/extensions/load-extensions.ts` (create — concrete `ExtensionAPI` impl: event bus (`on`/dispatch), tool registry; runs each factory's `register`; exposes registered tools + a `dispatch(event, payload)` the session/loop calls)
- `apps/mobile/lib/agent/extensions/__tests__/extensions.test.ts` (create)
- `apps/mobile/lib/agent/session.ts` (modify — accept `extensions?: ExtensionFactory[]`, load them, merge tools additively, dispatch `before_agent_start` to compose the system prompt)
- `apps/mobile/lib/agent/session.test.ts` (modify)
- `apps/mobile/lib/agent/index.ts` (modify — export the extension surface)

**Approach:** Define types mirroring Pi's `core/extensions/types.d.ts` — `ExtensionAPI` with `on<E>(type, handler) => () => void`, `registerTool(tool) => () => void`, `logger`; an `ExtensionEvent` discriminated map keyed by Pi's event names; `before_agent_start` handler returns `{ systemPrompt?: string }`. Drop `registerCommand`/`registerShortcut`/`ui`/exec/session-tree actions. `defineExtension` mirrors `packages/pi-extensions/src/define-extension.ts` (validate non-empty `name` + `register` fn, return branded). `load-extensions` builds the concrete API: a small typed event bus (`on` stores handlers per event; `dispatch` invokes them in registration order and folds results, e.g. chaining `systemPrompt`) plus a tool registry; runs each factory's `register(api)` (await async). An extension whose `register` throws is logged + skipped (others still load). `createAgentSession` runs the loader, concatenates extension tools onto existing tools (additive — built-ins kept), and composes the system prompt by dispatching `before_agent_start` with the base prompt. Store the loaded API/bus on the session so the loop can dispatch other events later. **Keep the bus minimal** — a typed `Map<event, handler[]>`, not a config/policy system (over-abstraction guardrail).

**Patterns to follow:** `packages/pi-extensions/src/define-extension.ts` + `src/memory.ts` (authoring shape — `register(pi, providers)`; mobile's `register(pi)` drops the provider bundle for v1); Pi's `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` (the surface); existing `apps/mobile/lib/agent/session.ts` + `turn-context.ts` (merge point).

**Test scenarios:**
- `defineExtension` returns a factory; rejects missing `name`/`register` at authoring time.
- An extension calling `registerTool` → that tool appears in the loaded tool set; the returned unregister fn removes it.
- An extension registering an `on("before_agent_start")` handler that returns `{ systemPrompt }` → the composed session system prompt reflects it.
- Two `before_agent_start` handlers → chained in registration order (each sees the prior's output).
- `on(...)` for a non-dispatched event (e.g. `tool_call`) → handler is stored and invocable via the bus `dispatch` (unit-test the bus directly), proving the event system is real, not just before_agent_start.
- The unregister fn returned by `on` removes the handler.
- Two extensions → tools and handlers from both merge in registration order.
- Async `register` (awaits a fetch) → loader awaits it before the session is usable.
- Built-in/directly-passed tools preserved alongside extension tools (additive).
- An extension whose `register` throws → logged + skipped; other extensions still load.

**Verification:** Unit tests green; `createAgentSession({ extensions: [ext] })` yields a session whose advertised tools + composed system prompt include the extension's contributions, with built-ins intact, and whose event bus dispatches to registered handlers.

---

### U2. Server-side MCP proxy (`tools/list` + `tools/call`)

**Goal:** Let the device list + call the tenant's MCP tools as the signed-in user, no secrets on device.

**Requirements:** Tenant-scoped discovery; per-user auth; foundation for U3.

**Dependencies:** none (parallel to U1).

**Files:**
- `packages/api/src/handlers/mcp-proxy.ts` (create)
- `packages/api/src/handlers/__tests__/mcp-proxy.test.ts` (create)
- `packages/api/src/lib/model-proxy/` (reuse the auth/tenant-resolution helper `model-converse` uses; extract/share if one exists rather than duplicating)
- `terraform/modules/app/lambda-api/handlers.tf` (modify — add to BOTH `local.api_routes` AND the `aws_lambda_function.handler` `toset([...])`)
- `scripts/build-lambdas.sh` (modify — add `mcp-proxy`; bundled-SDK list only if the upstream transport needs a non-externalized client)

**Approach:** Follow `packages/api/src/handlers/model-converse.ts` for auth (idToken → `resolveCallerTenantId` email fallback), 401/403 gating, error envelope, CORS. Switch on path/body `method`: `tools/list` resolves the tenant's MCP endpoint and forwards JSON-RPC `tools/list`, returning `{ name, description, inputSchema }[]`; `tools/call` forwards `{ name, arguments }` and returns the result, passing MCP `isError` results through as 200 (not 500) so the loop recovers.

**Patterns to follow:** `packages/api/src/handlers/model-converse.ts`, `record-turn.ts`. Registration: `[[feedback_lambda_zip_build_entry_required]]` — both `handlers.tf` map entries AND `build-lambdas.sh` required, or the deploy breaks (burned in #1831/#1832).

**Test scenarios:**
- `tools/list` with valid idToken → tenant tool defs (mock upstream transport); names/schemas pass through.
- `tools/call` forwards `{name, arguments}` → returns upstream result verbatim.
- Upstream `isError` → returned as 200 error body, not a 500.
- Missing/invalid idToken → 401; authenticated non-member tenant → 403 (mirror model-converse gating).
- Google-federated caller (null `ctx.auth.tenantId`) → tenant resolved via email fallback.
- Upstream transport failure → handled 502 envelope, no unhandled throw.

**Verification:** Deployed handler 401s unauthenticated; with a real idToken, `tools/list` returns a non-empty array for a tenant with MCP tools. Post-merge Deploy green (`[[feedback_watch_post_merge_deploy_run]]`).

---

### U3. MCP tools as the first extension, wired into the thread turn

**Goal:** The on-device agent reaches the tenant's MCP tools via a `defineExtension` extension — the first proof of the U1 seam.

**Requirements:** Tools reach the model as an extension; per-user auth; built-ins kept.

**Dependencies:** U1, U2.

**Files:**
- `apps/mobile/lib/agent/extensions/mcp-tools-extension.ts` (create — `mcpToolsExtension(deps)` via `defineExtension`)
- `apps/mobile/lib/agent/extensions/__tests__/mcp-tools-extension.test.ts` (create)
- `apps/mobile/lib/mcp-client.ts` (modify or wrap — add proxy-backed `tools/list` + idToken-authed `call`; keep the shared-bearer path until callers migrate)
- `apps/mobile/lib/agent/thread-turn.ts` (modify — assemble `extensions: [mcpToolsExtension(...)]`, pass to `createAgentSession`)
- `apps/mobile/lib/agent/thread-turn.test.ts` (modify)

**Approach:** `mcpToolsExtension` = `defineExtension({ name: "mcp-tools", description, register })` where `register` lists tenant tools via the proxy (`listTenantTools(idToken)`), maps each through the existing `createMcpTool(def, call)` (`call` = idToken-authed proxy `tools/call`), calls `pi.registerTool(...)` per tool, and adds a `pi.on("before_agent_start", e => ({ systemPrompt: e.systemPrompt + fragment }))` describing the connected tools. `getIdToken`/`fetch` injectable (mirror `BedrockModelProvider`). `apiBase` = `EXPO_PUBLIC_GRAPHQL_URL` minus `/graphql` (same as `providers/bedrock.ts`, `persist-turn.ts`). `runThreadHarnessTurn` builds the extension list and passes it to `createAgentSession`; the thread screen stays thin (no tool/extension assembly in the UI). On `tools/list` failure, the extension registers nothing (turn degrades to plain chat) — no throw escapes.

**Patterns to follow:** `packages/pi-extensions/src/memory.ts` (extension authoring shape — `register(pi, providers)`, `pi.registerTool`, `pi.on(...)`); `apps/mobile/lib/agent/tools/mcp-tool.ts` (`createMcpTool` — reuse); `apps/mobile/lib/agent/providers/bedrock.ts` (apiBase + injectable token/fetch).

**Test scenarios:**
- `register` lists tools via injected proxy and registers one tool per def; each `execute` calls proxy `tools/call` with `{name, arguments}`.
- `register` adds a `before_agent_start` handler contributing a fragment mentioning connected tools.
- A mock model emitting a tool call → the registered tool executes and the final answer reflects the result (extend the existing `runs tools mid-turn` test through the extension path).
- `tools/list` failure → extension registers nothing, turn completes as plain chat, no throw.
- Upstream `isError` from `tools/call` → surfaced as an error tool-result (loop recovers), not a throw.
- Built-ins + any directly-passed tools preserved alongside extension tools.

**Verification:** Unit tests green; with the extension wired, a tool-requiring prompt drives a real tool call in the loop via the proxy.

---

### U4. Image input through the thread composer (host concern)

**Goal:** Attach a photo (library or camera) that flows into the turn as model-vision input.

**Requirements:** Image input reaches the model; business-card flow enabled.

**Dependencies:** U3 (so the model has a tool to call after reading the image).

**Files:**
- `apps/mobile/lib/agent/tools/image-picker.ts` (modify — add camera launcher beside `launchImagePicker`)
- `apps/mobile/app/thread/[threadId]/index.tsx` (modify — attach affordance; pass picked `ImagePart` into the turn)
- `apps/mobile/lib/agent/thread-turn.ts` (modify — accept `images?: ImagePart[]`, pass to `session.prompt(userText, images)`)
- `apps/mobile/lib/agent/thread-turn.test.ts` (modify)
- `apps/mobile/app.json` (verify/add `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` — missing strings crash on first attach)

**Approach:** Add `launchCamera` (expo-image-picker `launchCameraAsync`, permission-gated) beside `launchImagePicker`. Composer attach button (existing `+`/paperclip area) → library or camera → `pickImage(launch)` → `ImagePart`, with a small pending thumbnail before send. `handleSend` passes `ImagePart[]` to `runThreadHarnessTurn` → `session.prompt(userText, images)`. Not modeled as an extension (KTD5).

**Patterns to follow:** `apps/mobile/lib/agent/capture-image.ts` + `tools/image-picker.ts` (pure mapper vs native launcher split — keep launcher native, mapper pure).

**Test scenarios (pure core; native launcher excluded):**
- `pickImage` with a camera-launcher result containing base64 → `ImagePart` with correct `format` from mime.
- `runThreadHarnessTurn` given `images` passes them to `session.prompt` (mock provider request carries the image block).
- No image → `session.prompt` called with empty/undefined images (unchanged).
- Permission denied / cancel → `pickImage` returns null, turn still sendable as text.

**Verification (live, sim):** Attach a business-card photo + "create an opportunity from this card" → model reads the card, calls an MCP tool with extracted fields; result renders + persists.

---

### U5. Live end-to-end verification in the iOS simulator

**Goal:** Prove seam → extension → proxy → tool-call → answer on a real turn before TestFlight.

**Requirements:** All of the above working together.

**Dependencies:** U1–U4.

**Files:** none (verification unit).

**Approach:** With the deployed proxy (U2) and the sim on this branch: (a) a message requiring a known tenant MCP tool → `model-converse` logs `toolCalls > 0`, `mcp-proxy` logs `tools/call`, the result is in the persisted answer; (b) a business-card image → vision → tool-call → answer; (c) the "Working…" indicator covers the multi-step tool turn and clears on completion.

**Test expectation: none — live verification unit.** Coverage lives in U1–U4.

**Verification:** CloudWatch shows `mcp-proxy` `tools/list` + `tools/call` for the caller's tenant; `model-converse` shows `toolCalls > 0`; in-thread answer reflects tool output; image turn produces a tool call from extracted fields.

---

## Deferred to Implementation

- **Loop event dispatch depth (U1):** the event bus is built and `before_agent_start` is dispatched in v1. Wiring loop dispatch for `tool_call`/`before_tool_call`/`after_tool_call`/`agent_*` is added as real consumers arrive — handlers are stored and the bus is testable now. Keep the loop tiny (Pi-faithful).
- **`before_agent_start` result shape (U1):** mirror Pi's `BeforeAgentStartEvent { systemPrompt }` + `BeforeAgentStartEventResult { systemPrompt? }` (cloud #1847 is the reference).
- **Tenant MCP endpoint resolution (U2):** confirm where the cloud agent's `mcp_configs` / tenant MCP URL come from (Strands/SSM/DB) and reuse. If only the Builder MCP (`api.thinkwork.ai/mcp/builder`) is available, target it first.
- **Bundled-SDK decision (U2):** whether `mcp-proxy` inlines an SDK or externalizes `@aws-sdk/*` — depends on upstream transport (plain `fetch` JSON-RPC needs nothing extra).
- **Extension extraction trigger:** after a second extension lands, extract `apps/mobile/lib/agent/` → `packages/pi-hermes`. Not this plan.
- **Empty-tool UX:** how the agent phrases "no tool for that" (base system prompt already covers the general case).

---

## Risks & Dependencies

- **Terraform/Lambda registration (U2)** — highest-risk step. Missing either the `handlers.tf` `toset` entry or the `build-lambdas.sh` entry breaks main's deploy for everyone (`[[feedback_lambda_zip_build_entry_required]]`; burned #1831/#1832). Verify both pre-merge; watch the post-merge Deploy.
- **Over-abstraction risk (U1)** — the extension seam must stay *small*. The event bus is a typed `Map<event, handler[]>`, not a config/policy engine. If `load-extensions` or the loop starts needing config systems to work, that's the smell of leaving Pi's philosophy — stop and reconsider rather than build it. (Explicit user directive this session.)
- **idToken acceptance upstream (U2)** — if the tenant MCP server can't be reached/authenticated server-side, `tools/list` returns empty and the extension registers nothing. U3 degrades to plain chat (fails safe), but U5 must confirm a real non-empty list.
- **iOS permissions (U4)** — missing camera/photo usage strings crash on first attach; the `app.json` check is load-bearing.
- **Deploy ordering** — U2 must merge + deploy before U3/U4 are useful on device; ship U2 early and confirm the endpoint is live.

---

## Sources & Research

- **Cloud extension model (the shape to mirror):** `packages/pi-extensions/src/define-extension.ts`, `src/memory.ts`, `src/index.ts`; `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` (`ExtensionAPI = ExtensionContext & ExtensionContextActions`; `on<E>(type, handler)`; `registerTool(tool)`; `before_agent_start` event with `BeforeAgentStartEventResult { systemPrompt? }`). Shipped via #1836/#1843/#1847/#1852/#1854/#1856.
- **Why mobile can't reuse the cloud package:** `@thinkwork/pi-extensions` depends on `@earendil-works/pi-coding-agent` (native) + `@thinkwork/pi-runtime-core` (Node); spike `docs/solutions/spikes/2026-05-29-mobile-embedded-node-pi-spike.md`.
- **Mobile harness primitives:** `apps/mobile/lib/agent/{thread-turn,turn-context,session,loop}.ts`, `tools/mcp-tool.ts`, `capture-image.ts`, `tools/image-picker.ts`, `providers/bedrock.ts`, `persist-turn.ts`.
- **Proxy pattern:** `packages/api/src/handlers/model-converse.ts`, `record-turn.ts`; `packages/api/src/lib/model-proxy/converse-mapping.ts` (tool specs + image blocks supported).
- **Insufficient device MCP client:** `apps/mobile/lib/mcp-client.ts` (shared bearer, no `tools/list`).
- **Learnings:** `[[project_pi_extensions_architecture]]`, `[[project_pi_leverage_builtin_tools]]`, `[[feedback_lambda_zip_build_entry_required]]`, `[[feedback_oauth_tenant_resolver]]`, `[[feedback_watch_post_merge_deploy_run]]`, `[[project_eas_node_pin_workspace_floor]]`.
