---
title: Computer AI Elements + iframe substrate contract v1
type: spec
status: active
date: 2026-05-09
plan: docs/plans/2026-05-09-012-feat-computer-ai-elements-adoption-plan.md
origin: docs/brainstorms/2026-05-09-computer-ai-elements-adoption-requirements.md
supersedes_decision_in:
  - docs/plans/2026-05-09-001-feat-computer-applets-reframe-plan.md
---

# Computer AI Elements + iframe substrate contract v1

This document freezes the v1 contract for Computer's LLM-UI substrate after
adoption of the Vercel AI SDK ecosystem (AI Elements + `useChat` + `UIMessage`)
end-to-end and the iframe-isolated execution path for LLM-authored React
fragments. It is the coordination artifact for plan
`docs/plans/2026-05-09-012-feat-computer-ai-elements-adoption-plan.md` and
explicitly supersedes plan-001's same-origin trust decision wherever the
iframe substrate replaces it. Plan-001's same-origin substrate
(`apps/computer/src/applets/`, `@thinkwork/computer-stdlib`, applet GraphQL
surface, Strands `save_app`/`load_app`/`list_apps`) remains the foundation;
the iframe flip below reverses only the same-origin execution boundary
plan-001 accepted under prompt injection.

Future incompatible changes create a sibling spec at
`docs/specs/computer-ai-elements-contract-v2.md`. Once downstream units lock
against this contract, do not silently rewrite it.

## Plan-001 substrate precondition

This contract assumes the following plan-001 artifacts are present and behave
as plan-001 specified. Implementation units must verify presence before
proceeding; any miss pauses adoption work until plan-001 ships.

- `apps/computer/src/applets/mount.tsx` (`AppletMount`, iframe-only generated app mount)
- `apps/computer/src/applets/host-registry.ts` (single-owner symbol guard)
- `apps/computer/src/applets/transform/transform.ts` + `sucrase-worker.ts`
- `apps/computer/src/applets/transform/import-shim.ts` (acorn AST walk +
  `ALLOWED_APPLET_IMPORTS` allowlist)
- `apps/computer/src/applets/host-applet-api.ts`
  (`createHostAppletAPI` returning `{useAppletState, useAppletQuery,
useAppletMutation, refresh}`)
- `packages/computer-stdlib/` (workspace package, source-as-published)
- `packages/api/src/lib/applets/`,
  `packages/api/src/graphql/resolvers/applets/` (GraphQL applet surface)
- `packages/agentcore-strands/agent-container/container-sources/applet_tool.py`
  (`make_save_app_fn`/`make_load_app_fn`/`make_list_apps_fn` factory closures)

## Wire vocabulary — `UIMessagePart` discriminators

Messages flow end-to-end as Vercel AI SDK `UIMessage` shapes. Allowed
`UIMessagePart` discriminators in v1 are exactly:

```text
text
reasoning
tool-${name}                # name is the Strands tool name, e.g. tool-renderFragment
source-url
source-document
file
data-${name}                # name is the channel name, e.g. data-progress
step-start
```

There is **no** custom top-level `fragment` part. LLM-authored React
fragments are encoded as a `tool-renderFragment` part. A future v2 may
introduce sibling tool-`*` channels for code-interpreter integration, etc.;
they do not break v1.

### `tool-renderFragment` shape

`input` (terminal `tool-input-available` payload):

```json
{
  "tsx": "<TSX source string>",
  "version": "<semver, e.g. 0.1.0>",
  "themeRequirement": "inherit"
}
```

`output` (terminal `tool-output-available` payload, posted by the iframe
controller after the iframe acknowledges mount):

```json
{
  "rendered": true,
  "channelId": "<per-iframe nonce>",
  "renderedAt": "<ISO 8601>"
}
```

`output` on iframe error:

```json
{
  "rendered": false,
  "channelId": "<per-iframe nonce>",
  "error": {
    "code": "IMPORT_REJECTED" | "COMPILE_FAILED" | "RUNTIME_ERROR" | "CSP_VIOLATION",
    "message": "<short summary>",
    "detail": "<structured info, e.g. rejected import name>"
  }
}
```

Tool input is emitted as terminal `tool-input-available` only —
`tool-input-delta` deltas are skipped in v1 because Strands materializes
tool-call arguments atomically.

## AppSync chunk envelope — `ComputerThreadChunkEvent.chunk`

The existing AppSync subscription
`onComputerThreadChunk(threadId: ID!): ComputerThreadChunkEvent` and its
notification mutation `publishComputerThreadChunk` are unchanged. Only the
**inside** of the `chunk: AWSJSON` field changes shape.

For Computer threads with typed emission gated on (`ui_message_emit=True`,
see `Typed-emission gating` below), each `chunk` payload is a JSON object
matching exactly one row of the
[UI Message Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
wire format:

```text
start                       { "type": "start", "messageId": "<assistant message id>" }
text-start                  { "type": "text-start", "id": "<part id>" }
text-delta                  { "type": "text-delta", "id": "<part id>", "delta": "<chunk>" }
text-end                    { "type": "text-end", "id": "<part id>" }
reasoning-start             { "type": "reasoning-start", "id": "<part id>" }
reasoning-delta             { "type": "reasoning-delta", "id": "<part id>", "delta": "<chunk>" }
reasoning-end               { "type": "reasoning-end", "id": "<part id>" }
tool-input-available        { "type": "tool-input-available", "toolCallId": "<id>", "toolName": "<name>", "input": { ... } }
tool-output-available       { "type": "tool-output-available", "toolCallId": "<id>", "output": { ... } }
source-url                  { "type": "source-url", "id": "<part id>", "url": "..." }
source-document             { "type": "source-document", "id": "<part id>", "title": "...", "url": "..." }
file                        { "type": "file", "id": "<part id>", "url": "...", "mimeType": "..." }
data-${name}                { "type": "data-<name>", "id": "<part id>", "data": { ... } }
start-step                  { "type": "start-step" }
finish-step                 { "type": "finish-step" }
finish                      { "type": "finish" }
abort                       { "type": "abort" }
error                       { "type": "error", "errorText": "<short message>" }
```

### Runbook `data-*` parts

Computer runbooks use `data-${name}` parts for approval and progress.

`data-runbook-confirmation` is emitted for auto-selected published runbooks
before execution starts:

```json
{
  "type": "data-runbook-confirmation",
  "id": "runbook-confirmation:<runId>",
  "data": {
    "runbookRunId": "<uuid>",
    "runbookSlug": "map-artifact",
    "runbookVersion": "0.1.0",
    "displayName": "Map Artifact",
    "title": "Build Map Artifact",
    "summary": "Computer will discover location data...",
    "expectedOutputs": ["Interactive map artifact"],
    "likelyTools": ["workspace search", "artifact builder"],
    "phaseSummary": [
      "Discover entities...",
      "Produce a map-centered artifact."
    ],
    "candidates": [
      {
        "slug": "map-artifact",
        "displayName": "Map Artifact",
        "confidence": 0.84
      }
    ]
  }
}
```

`data-runbook-queue` is emitted for explicit, approved, running, completed,
failed, cancelled, and ad hoc plan progress:

```json
{
  "type": "data-runbook-queue",
  "id": "runbook-queue:<runId-or-ad-hoc-id>",
  "data": {
    "runbookRunId": "<uuid-or-null>",
    "runbookSlug": "crm-dashboard",
    "runbookVersion": "0.1.0",
    "displayName": "CRM Dashboard",
    "status": "running",
    "currentTaskKey": "produce:1",
    "phases": [
      {
        "id": "produce",
        "title": "Produce dashboard artifact",
        "tasks": [
          {
            "id": "<task uuid>",
            "taskKey": "produce:1",
            "title": "Generate an interactive CRM dashboard...",
            "status": "running"
          }
        ]
      }
    ]
  }
}
```

Queue updates for the same run MUST reuse the same `id`, normally
`runbook-queue:<runId>`. The client replaces an existing `data-*` part with
the same `type` and `id`; changing ids appends duplicate Queue cards.

Persisted assistant `Message.parts` MUST include these data parts. Thread
reload renders `parts` before legacy `content`, so confirmation and queue
cards remain visible after navigation.

`text-start` IDs are **stable per part across deltas**. Minting a new id per
delta renders the same logical text part as N separate text bubbles in the
client; this is a producer bug, not a consumer accommodation. Reasoning ids
are stable analogously per reasoning block.

`ComputerThreadChunkEvent.seq` is preserved as a **transport-only** retry
hint for connection healing. It MUST NOT be used to gate render order on
the consumer; the per-part-id append cursor below replaces the legacy
`seq < highest - 2` window heuristic.

For non-Computer agents (Flue, sub-agents, etc.) sharing the AgentCore
runtime, typed emission stays off and the publisher continues to write the
legacy `{ "text": "<chunk>" }` envelope. Cross-agent regression is a P0;
see `Typed-emission gating` below.

### Per-part-id append cursor rule

The consumer maintains a `Map<partId, UIMessagePart>` per thread. On each
chunk:

- `*-start` chunks instantiate a new part record with `id` and initial
  state.
- `*-delta` chunks look up the existing part by `id`, append `delta` in
  arrival order, and update the streaming state.
- `*-end` chunks transition the part to terminal.
- `tool-input-available` instantiates a new tool part by `toolCallId` with
  state `input-available`.
- `tool-output-available` updates an existing tool part by `toolCallId` to
  state `output-available`.
- `start-step` / `finish-step` / `start` / `finish` / `abort` are
  transport-level signals; they do not mutate parts directly.

Out-of-order deltas **within a single text or reasoning part** are a
producer bug. The consumer does not attempt to reorder by content. Mixed
chunks across different ids (`text-delta(p1) → tool-input-available(t1) →
text-delta(p1) → tool-output-available(t1)`) are normal and supported.

A chunk arriving with an unknown `type` is dropped with a structured
warning; the stream remains healthy. A chunk addressing a part already in
terminal state is dropped with a structured warning.

### Legacy-vs-protocol detection (shape-based, not id-based)

Some valid protocol chunk types legitimately have no `id` field — `start`,
`finish`, `start-step`, `finish-step`, `abort`, and `error` are
transport-level signals that carry no per-part identity. Tool chunks
(`tool-input-available`, `tool-output-available`) carry `toolCallId` but
not `id`. These are normal protocol traffic and MUST flow through the
protocol path, not a legacy fallback.

Legacy-shape detection is therefore **shape-based**, not id-based. A
parsed chunk is treated as a legacy `{text}` envelope when ALL of the
following hold:

1. The chunk has no `type` field, or `type` is not a string.
2. The chunk has a `text` field whose value is a string.

Anything else — including a chunk with a known protocol `type` but no
`id` — is protocol traffic and is dispatched by `type`. A chunk that
matches neither the legacy nor any known protocol shape is dropped with a
structured warning; the stream remains healthy.

This rule survives the Phase 2 cleanup that retires the legacy fallback:
the cleanup deletes the legacy branch of `mergeUIMessageChunks` and the
chunk parser's legacy detector, leaving only the type-dispatch path.
Until then, the legacy shape is the **only** path that uses an
absence-of-`type` test; protocol chunks are never demoted to legacy
because of a missing `id`.

## `useChat` transport submit-ownership

`useChat` is the single source of submit/regenerate. The transport adapter
(`apps/computer/src/lib/use-chat-appsync-transport.ts`,
`createAppSyncChatTransport`) implements Vercel's
`ChatTransport<UIMessage>` interface and is the **sole caller** of the
existing turn-start GraphQL mutation chain.

Today's turn-start chain on the client is `sendMessage(input:
SendMessageInput!)` (and `createThread(input: CreateThreadInput!)` when the
thread does not yet exist). The transport adapter wraps both. Composers
call **only** `useChat().sendMessage({text, files})`. Any direct call to
`SendMessageMutation` from a composer (`ComputerComposer`,
`FollowUpComposer`, or any later sibling) is a regression. The `U13`
single-submit invariant is a P0 release gate.

`ChatTransport.sendMessages({trigger, chatId, messageId, messages,
abortSignal})` returns `Promise<ReadableStream<UIMessageChunk>>`. It MUST:

1. Resolve the existing thread or create a new one. If `chatId` resolves
   to an existing Computer thread, skip `CreateThreadMutation`. Otherwise
   call it once per fresh-thread submit.
2. Call `SendMessageMutation` exactly once per `submit-message` trigger
   with the user's prompt.
3. On `regenerate-message` trigger: cancel the in-flight assistant turn
   (existing cancellation path from the legacy composer wiring) and
   re-issue the turn. There is exactly one mutation invocation per
   regenerate.
4. Subscribe (or reuse the existing subscription) to
   `onComputerThreadChunk(threadId)` for the duration of the stream.
5. Construct a `ReadableStream<UIMessageChunk>` whose `start(controller)`
   registers the subscription handler. Each AppSync envelope's `chunk`
   field is `JSON.parse`-d, validated against the chunk-type vocabulary
   above, and `controller.enqueue`-d.
6. Wire `abortSignal.addEventListener("abort", ...)` so abort unsubscribes
   from AppSync and closes the controller.
7. Surface subscription errors by `controller.error(err)`. `useChat`
   exposes these via `status: "error"`.

`reconnectToStream({chatId})` returns `null` in v1. Page reload during a
streaming turn loses the live `useChat` stream; the persisted message-list
query rehydrates the final assistant message once `finish` lands and the
writer commits `parts` (see `Persistence boundary` below). A future v2 may
ship a server-side replay buffer.

`createAppSyncChatTransport` exposes a `transportStatus` getter with the
state machine `'idle' | 'streaming' | 'closed' | 'errored'` for deploy
smoke pinning.

## Artifact runtime trust modes

Computer uses an explicit host-owned runtime vocabulary for generated App
artifact surfaces:

```ts
type AppArtifactRuntimeMode = "sandboxedGenerated" | "nativeTrusted";
```

All arbitrary LLM-authored App artifacts resolve to
`sandboxedGenerated`, regardless of any `metadata.runtimeMode`,
`metadata.trust`, or similar fields persisted with the artifact. The
metadata is model-authored/user-influenced content and MUST NOT select
execution trust. `sandboxedGenerated` means the artifact body mounts
through `AppletMount` and the iframe substrate described below.

`nativeTrusted` is reserved for a future host-owned path for vetted
first-party components. It is a vocabulary placeholder only in v1; no
generated App metadata can opt into it, and this contract does not define
a native renderer.

## AppletMount controller contract

Plan-001's `AppletMount` interface
(`loadModule(source, version) → Promise<ComponentType>`) is **deprecated**.
Under the iframe substrate the rendered component lives inside the iframe,
not in the parent's React tree, so the parent cannot return a
`ComponentType` to React.

The replacement: `AppletMount` (and the `IframeAppletController` that
backs it) renders an `<iframe>` element directly and exposes a controller
object as the public surface:

```ts
interface IframeAppletController {
  element: HTMLIFrameElement;
  ready: Promise<void>; // resolves on `kind: "ready-with-component"` (matching channelId)
  dispose: () => void;
  sendCallback: (name: string, payload: unknown) => void;
  applyTheme: (overrides: Record<string, string>) => void;
  getState: (key: string) => Promise<unknown>;
  setState: (key: string, value: unknown) => Promise<void>;
  channelId: string; // exposed for tests / smoke
  status: "pending" | "ready" | "errored" | "disposed";
}
```

Generated app artifacts have no same-origin loader. `AppletMount` always
creates the sandbox iframe controller; missing sandbox configuration is a
deployment failure and rendering fails closed rather than executing
LLM-authored code in the parent origin.

## Parent ↔ iframe `postMessage` protocol

The iframe substrate runs at `https://sandbox.thinkwork.ai/iframe-shell.html`
and is loaded with `sandbox="allow-scripts"` (NO `allow-same-origin`). The
iframe document's effective origin is therefore opaque, serialized as the
string `"null"` by the browser. Two browser-API consequences fall out of
this and dictate the protocol design:

1. **Inbound to parent:** `event.origin` on a message _from_ the iframe is
   `"null"`. Origin-equality checks on the parent side cannot validate the
   sender. Trust on parent inbound comes from
   `event.source === iframeWindow` (the specific
   `HTMLIFrameElement.contentWindow` the parent itself created) AND
   `envelope.channelId === expectedChannelId` (a nonce minted at parent-side
   iframe construction, sent down via `init`, and required on every
   subsequent envelope).
2. **Outbound from parent:** the parent CANNOT use `targetOrigin:
"https://sandbox.thinkwork.ai"`. The browser checks `targetOrigin`
   against the iframe document's _effective_ origin, which under
   `sandbox="allow-scripts"` (no `allow-same-origin`) is opaque/`"null"` —
   the message would be silently dropped. The parent therefore MUST send
   with `targetOrigin: "*"`. This is the single most-likely
   misunderstanding in code review; see `Anti-pattern: tightening
targetOrigin` below.

Trust on parent → iframe outbound is layered:

- **Pinned iframe `src`**: the parent constructs the iframe with
  `src = __SANDBOX_IFRAME_SRC__` (a Vite `define`-injected build-time
  constant per stage, e.g.
  `https://sandbox.thinkwork.ai/iframe-shell.html`) and never reassigns
  the `src` attribute during the iframe's lifetime. The browser guarantees
  the iframe's loaded document is whatever `src` resolves to (modulo a
  successful HTTPS load against the response-headers policy), and
  ThinkWork owns that origin's S3 bucket + CloudFront distribution +
  ACM cert end-to-end. There is no scenario in which a hostile document
  inhabits the iframe we created without first compromising our own
  sandbox subdomain.
- **Iframe-side build-time parent-origin allowlist**: the iframe verifies
  `event.origin` on every inbound parent message against a Vite
  `define`-injected `__ALLOWED_PARENT_ORIGINS__` list of trusted parent
  origins (e.g. `["https://thinkwork.ai", "https://dev.thinkwork.ai"]`).
  Anything else is dropped silently and logged. The allowlist is
  build-time-baked, not runtime-discoverable. `null` and `*` MUST NEVER
  appear in the allowlist; the iframe-shell test asserts this directly.
- **Channel nonce on every envelope**: outbound envelopes carry
  `channelId` so a confused-deputy iframe (e.g. a sibling iframe in the
  same parent for a different fragment) cannot consume messages addressed
  to a different controller. Nonce is minted at controller construction
  via `crypto.randomUUID()`.
- **No-secrets-in-payload invariant**: the parent never includes API
  tokens, Cognito JWTs, raw tenant ids, session cookies, or other
  credentials in any envelope sent into the iframe. The iframe runs
  untrusted LLM-authored code and has no need for raw credentials. State
  proxy operations (`state-read` / `state-write`) round-trip through the
  parent, which holds the credentials and runs the GraphQL mutation on
  the iframe's behalf — the iframe sees only the operation result.
  `targetOrigin: "*"` is therefore safe by construction.

### Envelope shape

```ts
interface Envelope<P = unknown> {
  v: 1;
  kind:
    | "init" // parent → iframe: TSX + version + theme overrides + channelId
    | "ready" // iframe → parent: handshake ack pre-render
    | "ready-with-component" // iframe → parent: render mounted, channelId echoed
    | "theme" // parent → iframe: dynamic theme overrides only
    | "resize" // iframe → parent: { height: number }
    | "callback" // parent → iframe: { name, payload } for declared callbacks
    | "state-read" // iframe → parent: { key } (request)
    | "state-read-ack" // parent → iframe: { value } (reply, replyTo set)
    | "state-write" // iframe → parent: { key, value } (request)
    | "state-write-ack" // parent → iframe: { ok } (reply, replyTo set)
    | "error"; // either direction: { code, message, detail }
  payload: P;
  msgId: string; // crypto.randomUUID() per envelope
  replyTo?: string; // matches msgId of the request being acked
  channelId: string; // per-iframe nonce
}
```

`MessageChannel`-port alternatives are rejected — channels add complexity
without ergonomic gain at this scale.

### Anti-pattern: tightening `targetOrigin`

Any reviewer or follow-up agent who proposes "parent should pin
`targetOrigin` to the sandbox URL" or "never use `targetOrigin: '*'`" is
reasoning from a non-sandboxed mental model. The architecture is
`sandbox="allow-scripts"` without `allow-same-origin`, which forces opaque
iframe origin, which forces `targetOrigin: "*"`. The trust mechanism is
**pinned src + iframe-side allowlist + channelId nonce + no-secrets in
payload**, not `targetOrigin` enforcement.

`U10` ships a regression test that spies on `iframe.contentWindow.postMessage`
and fails the build if a concrete origin string is ever passed. The test
is load-bearing and MUST NOT be removed without sibling-spec approval.

## Persistence boundary

All `UIMessage.parts` persist into a new `messages.parts jsonb` column on
**terminal-state transitions** for the part:

- `text-end` → persist final text part with full `text` field
- `reasoning-end` → persist final reasoning part with full `text` field
- `tool-output-available` → persist final tool part with both `input` and
  `output`
- `finish` → flush any pending non-finalized parts and write the full
  `parts` array

Intermediate `*-delta` chunks DO NOT persist. The persisted shape is the
post-stream `UIMessage.parts` array, not the wire chunk stream.

The legacy `messages.content` text column continues to populate at
turn-finalize as a flattened text representation (concatenated `text`
parts only; tool, reasoning, and `tool-renderFragment` parts are dropped
from `content`). This serves the small number of internal callers that
still read `content`. The flatten is lossy by design; anything needing the
rich shape reads `parts`.

Half-migrated rows (`parts` non-null AND `content` non-null) are expected.
The render-path precedence rule is **`parts IS NOT NULL` wins**.

### Tenant scoping

`Message.parts` carries tool input/output and reasoning content, which are
strictly more sensitive than legacy `Message.content`. Every read path
that selects `parts` MUST scope by `resolveCallerTenantId(ctx)` (per
`feedback_oauth_tenant_resolver` — `ctx.auth.tenantId` is null for
Google-federated callers and is unsafe as the source of truth) and pass
the same thread/computer ownership gate already enforced on
`Message.content`.

`U7` is the unit that lands the column, the GraphQL field, and the
explicit tenant audit. The U7 PR description must include a
trace-and-document pass over every code path that selects
`Message.parts` and either:

- confirm the existing message-list query already scopes correctly via
  thread/computer ownership against the caller's tenant (audit results
  documented), OR
- fix any pre-existing tenant gap before exposing `parts` (no widening of
  blast radius).

A regression test in `U7` mounts the resolver with a foreign tenant
context and asserts the foreign tenant cannot read another tenant's
message parts.

## Typed-emission gating

Typed `UIMessage` emission is gated **per-Computer-thread invocation**, NOT
via a process-wide AgentCore env var. The `ui_message_publisher.py` factory
closure accepts a `ui_message_emit: bool` kwarg (default `False`) and the
Computer thread handler entrypoint passes `True` when constructing the
publisher. Non-Computer entrypoints (Flue, sub-agent dispatch) leave the
kwarg at `False`; their streaming callbacks continue to publish the legacy
`{"text": "<chunk>"}` envelope.

The handler-entry signature is the wiring point. A naive
`UI_MESSAGE_EMIT_ENABLED=true` env var on the AgentCore runtime would flip
emission for **every** agent in the runtime — including non-Computer
agents that have no `useChat` consumer — and is explicitly rejected.

If a runtime-wide kill-switch is desired as belt-and-suspenders for staged
rollout, it MUST be an AND-gate above the per-thread capability (default
`true` so flipping to `false` disables for everyone). It MUST NOT replace
the per-thread flag.

`U5` lands the publisher with `ui_message_emit` defaulting `False` (inert
on the wire). `U6` flips the Computer handler to `True`. `U6`'s
capability-isolation test asserts:

- `get_ui_message_publisher_for_test()` resolves to `_live_emit` for the
  Computer entrypoint, and
- `get_ui_message_publisher_for_test()` resolves to `_inert_emit` (or the
  legacy publisher with `ui_message_emit=False`) for Flue and sub-agent
  entrypoints.

Both branches are required for the test to pass; either alone is a
regression.

## CSP profile

CSP is set via CloudFront response-headers policy on each static-site
distribution (NOT via `<meta>` tags in HTML).

### Host site (`computer_site` distribution serving `apps/computer`)

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
worker-src 'self';
frame-src https://sandbox.thinkwork.ai https://dev-sandbox.thinkwork.ai;
connect-src 'self'
            https://*.appsync-api.us-east-1.amazonaws.com
            wss://*.appsync-realtime-api.us-east-1.amazonaws.com
            https://cognito-idp.us-east-1.amazonaws.com;
img-src 'self' data: blob:;
font-src 'self' data:;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
```

Notes:

- `script-src 'self'` no longer needs `blob:` after the iframe substrate
  flip (Phase 2). Sucrase moves into the iframe scope, so blob URLs only
  exist inside `sandbox.thinkwork.ai`.
- `worker-src 'self'` similarly drops `blob:` because the parent no longer
  hosts the sucrase Web Worker.
- `frame-src` allowlist is the explicit set of sandbox subdomains per
  stage (production + dev/staging analogues). Wildcards are not used.
- `frame-ancestors 'none'` keeps `apps/computer` itself unframable (it is
  the parent, never a child).

### Iframe site (`computer_sandbox_site` distribution serving `sandbox.thinkwork.ai`)

```text
default-src 'none';
script-src 'self' blob:;
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'none';
object-src 'none';
base-uri 'self';
frame-ancestors https://thinkwork.ai https://dev.thinkwork.ai;
```

Notes:

- `default-src 'none'` is the closed baseline; every directive that allows
  resource loads is enumerated explicitly.
- `script-src 'self' blob:` and `worker-src 'self' blob:` permit sucrase
  blob URLs **inside** the iframe scope, where they belong.
- `style-src 'unsafe-inline'` is required for theme-token injection via
  `document.documentElement.style.setProperty` (Tailwind v4 uses inline
  CSS variables).
- `connect-src 'none'` is the load-bearing iframe boundary: the iframe
  CANNOT make any outbound network calls. Every side-effecting operation
  routes through the parent via the `state-read`/`state-write`/`callback`
  envelopes. Defense-in-depth: even if the host CSP regresses, the
  iframe's `connect-src 'none'` blocks fetch/exfiltration inside the
  iframe boundary.
- `frame-ancestors` allowlists the Computer parent origins (production
  - staging/dev analogues) so that hostile pages cannot frame the
    iframe-shell standalone. The exact origin list is wired in the
    CloudFront response-headers policy from Terraform per stage and MUST
    match the iframe-shell's `__ALLOWED_PARENT_ORIGINS__` Vite `define`
    list — they are the same trust set, expressed at two layers (CSP
    network gate + JS message gate).
- `X-Frame-Options` is **omitted** on this distribution because it must
  be framed by `apps/computer`; CSP `frame-ancestors` is the canonical
  modern equivalent and avoids the legacy header's binary
  same-origin-only behavior.
- `X-Content-Type-Options: nosniff` is set as a non-CSP header on both
  distributions.

### CSP smoke layering (deploy gate)

CSP enforcement only fires inside a real browser execution context. The
smoke is layered:

1. **Layer 1 — `curl -I` header presence checks** (cheap, every deploy).
   Asserts both distributions return the expected CSP profile in
   `content-security-policy`.
2. **Layer 2 — JSDOM/Vitest protocol tests** verify envelope parsing,
   channelId nonce checks, source-identity checks, and the `targetOrigin:
"*"` invariant. No browser dependency.
3. **Layer 3 — Playwright browser-level violation gate**
   (`scripts/smoke-csp-violation.mjs`): loads a known-bad fragment in a
   headless Chromium. The iframe-shell installs a `securitypolicyviolation`
   listener inside the iframe scope and forwards every violation to the
   parent over the `kind: "error"` envelope. The smoke asserts the parent
   received at least one violation envelope. Without Layer 3, the
   cross-origin sandbox boundary is unverified.

Playwright is added to `apps/computer/devDependencies` with a rationale
comment explicitly tying it to this CSP enforcement gate. It is NOT
silently introduced.

## AE4 / AE5 search-path constraint

Acceptance Examples 4 and 5 from the origin brainstorm assert the absence
of legacy raw-text mounts in the LLM-UI surfaces. The corrected search
constraints (per plan-012 Key Technical Decisions §`AE4 dead clause` and
§`AE check tightening`) are:

- **AE4 corrected**: search for raw `<Streamdown>` mounts **outside**
  `<Response>`'s internal use, and for literal `<span>{text}</span>`
  patterns. The brainstorm's reference to `react-markdown` is vacuous
  (zero matches in `apps/computer`); replace with `Streamdown` (the
  actual incumbent in `StreamingMessageBuffer.tsx:1` and
  `TaskThreadView.tsx:23,489`).
- **AE5**: search for fragment iframe mounts that satisfy the iframe
  isolation contract — `sandbox="allow-scripts"` (no `allow-same-origin`),
  `src` pinned to `__SANDBOX_IFRAME_SRC__`, controller exposed via
  `IframeAppletController`.
- **Search scope** (both AE4 and AE5):
  `apps/computer/src/components/computer/` AND
  `apps/computer/src/components/apps/`. The constraint exists because
  `apps/computer` uses `<span>{text}</span>` legitimately in non-LLM-UI
  surfaces (sidebar labels, button text); narrowing the search to
  LLM-UI directories prevents false positives.

## AI Elements coverage and `<JSXPreview>` exclusion

The R2 minimum coverage list in `apps/computer/src/components/ai-elements/`:

```text
conversation
message
response
reasoning
tool
code-block
artifact
web-preview
sandbox
prompt-input
suggestion
actions
```

`<JSXPreview>` is **explicitly excluded** from v1 coverage. It renders
untrusted JSX **same-origin** through `react-jsx-parser` to a `<div>` —
that is exactly the architecture posture this contract reverses. The
`react-jsx-parser` transitive dep MUST NOT appear in `apps/computer`'s
direct deps. A grep regression test in `U2` fails the build if either
`<JSXPreview>` source files or `react-jsx-parser` shows up outside
`docs/plans/` or `docs/specs/` references.

If a future trusted-JSX use case appears, it gets its own follow-up unit
under a sibling spec.

## Plan-008 supersession

`docs/plans/2026-05-09-008-feat-computer-thread-inline-visualizations-plan.md`
and `docs/brainstorms/2026-05-09-computer-thread-inline-visualizations-requirements.md`
are documentary-superseded — neither file ever shipped code (zero
references to `chart-spec` or `map-spec` anywhere in the codebase).
Inline visualizations are now produced as agent-authored React fragments
that mount through the iframe substrate. If either file later surfaces in
the working tree, add a `superseded-by` note pointing here and do nothing
else.

## Plan-001 banner

This contract supersedes plan-001's same-origin trust decision (plan-001
lines 142, 154 explicitly cited iframe isolation as the documented path
"if real-world incidents prove these controls insufficient"). Plan-001's
implementation status banner should reference this contract; the body of
plan-001 is not edited.

## Versioning

This is contract v1. Future incompatible changes create
`docs/specs/computer-ai-elements-contract-v2.md`. Breaking changes that
require a v2 include (illustrative, not exhaustive):

- Adding a new top-level `UIMessagePart` discriminator (e.g. `fragment`)
  beyond the AI SDK Stream Protocol vocabulary.
- Changing the iframe sandbox attributes (e.g. adding `allow-same-origin`)
  in any way that re-opens parent-DOM access for the iframe document.
- Flipping the `targetOrigin: "*"` invariant.
- Removing the per-thread `ui_message_emit` capability gate in favor of a
  runtime-wide flag.
- Backfilling `messages.parts` for historical rows (would require a
  migration spec separate from v1's "new rows only" stance).
- Promoting `<JSXPreview>` into v1 coverage.
- Replacing AppSync streaming with HTTP SSE.

Tightening (e.g. removing supported chunk types, narrowing the iframe CSP
further) MAY land within v1 if no consumer depends on the removed surface,
but document the change in this file.
