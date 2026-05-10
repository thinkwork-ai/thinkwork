---
title: "Status: feat: Computer LLM-UI adopts Vercel AI SDK end-to-end"
plan: docs/plans/2026-05-09-012-feat-computer-ai-elements-adoption-plan.md
status: shipped
date: 2026-05-09
---

# Plan-012 implementation status

All 14 implementation units shipped on `codex/computer-ai-elements-adoption`.

## Shipped units

| Unit | Commit | Notes |
|---|---|---|
| **U1** Contract spec | `e4cc17be`, `6d4537e2` | `docs/specs/computer-ai-elements-contract-v1.md` + plan-001 banner. Reviewer correction landed: shape-based legacy chunk detection + `frame-ancestors` CSP. |
| **U2 prep** Primitives | `d5d718d8` | `@thinkwork/ui` wildcard subpath export + accordion / button-group / hover-card primitives + `cn` shim. |
| **U2** AI Elements install | (commit landed in this session) | `apps/computer/src/components/ai-elements/` — 11 components installed + external deps (`motion`, `nanoid`, `shiki`, `use-stick-to-bottom`, `@radix-ui/react-use-controllable-state`, `@streamdown/{cjk,code,math,mermaid}`). `<JSXPreview>` deliberately excluded. |
| **U3** Sandbox subdomain Terraform (inert) | `a451e33f` | static-site module extended with optional `response_headers_policy_id` / `inline_response_headers`; new `computer_sandbox_site` instance gated on `var.computer_sandbox_domain`. 16 fixture tests + `terraform validate`. |
| **U4** useChat AppSync transport (inert scaffold) | `c2fd9d23` | `createAppSyncChatTransport` + chunk parser (shape-based legacy) + types + body-swap forcing-function test. 12 transport tests + 28 parser. |
| **U5** Strands UIMessage publisher (inert scaffold) | `2457999b` | `make_ui_message_publisher_fn` factory closure + per-Computer-thread `ui_message_emit` capability gate. 24 tests. `_boot_assert.EXPECTED_CONTAINER_SOURCES` extended. |
| **U6** Activate typed emission + per-part-id cursor | `f7da90e4` | `server.py` wires UIMessagePublisher when `computer_id and computer_task_id`. `ui-message-merge.ts` per-part-id append cursor. Drops the `seq < highest - 2` heuristic. 14 merge tests. |
| **U7** `messages.parts` jsonb + tenant audit | `1d8e7410` | Hand-rolled migration `0082_messages_parts_jsonb.sql`. Closes a pre-existing P0 cross-tenant exposure on `Query.messages` and `Thread.messages`. 5-test regression suite. **Apply via `psql -f` to dev after merge** per `feedback_handrolled_migrations_apply_to_dev`. |
| **U8** Thread surface adopts `<Response>` + transport adapter wired | (this session) | `apps/computer/src/components/ai-elements/response.tsx`. TaskThreadView + StreamingMessageBuffer swap raw `<Streamdown>` for `<Response>` (AE4 holds). Route instantiates `createAppSyncChatTransport` for smoke-pin observability. U4 inert-seam test deleted. |
| **U9** Iframe-shell bundle (inert) | `801a0ee1` | `apps/computer/src/iframe-shell/` — main.ts, protocol envelope types + helpers, content-scan, separate `vite.iframe-shell.config.ts` emitting a 36KB bundle. Build-time defines `__ALLOWED_PARENT_ORIGINS__` + `__SANDBOX_IFRAME_SRC__`. 32 tests. |
| **U10** IframeAppletController + postMessage live | (this session) | `apps/computer/src/applets/iframe-controller.ts`. Pins targetOrigin: '*' (REQUIRED for opaque-origin sandbox), source-identity gate, channelId nonce, recursive `assertNoSecretsInPayload`, dispose. 18 tests. |
| **U11** Iframe-shell handshake live + load-event init post | (this session) | iframe-shell main.ts handles init / theme / CSP-violation forwarding; iframe-controller posts init on iframe `load` event resolving the chicken-and-egg. **Production AppletMount cutover deferred to U11.5** (waits on iframe-shell TSX compile + mount pipeline). |
| **U12** `<Artifact>` chrome wraps canvas + inline applet | (this session) | `AppCanvasPanel` + `InlineAppletEmbed` wrap content in `<Artifact><ArtifactContent>`. Visual layout preserved via class overrides. |
| **U13** `useComposerState` hook + single-submit invariant | (this session) | `apps/computer/src/lib/use-composer-state.ts`. Grep-based regression test pinning that `ComputerComposer.tsx` and `FollowUpComposer` (in TaskThreadView.tsx) never import `SendMessageMutation`. Visual `<PromptInput>` swap of the two composer surfaces deferred to a focused follow-up. |
| **U14** `renderTypedPart` helper — Reasoning + Tool + Response + sources | (this session) | `apps/computer/src/components/computer/render-typed-part.tsx`. Translates each `AccumulatedPart` to an AI Elements primitive. 7 structural tests. TaskThreadView consumer wiring deferred to U14 follow-up (the helper is standalone for unit-tested independence). |

## Acceptance items implemented in this PR (after adversarial review)

| Item | Commit / where |
|---|---|
| **U11.5a** iframe-shell TSX compile + mount pipeline | `apps/computer/src/iframe-shell/main.ts` — sucrase-transform, acorn import-shim allowlist, dynamic import of blob URL, `createRoot.render(Component)`, full `kind:'error'` envelope routing, `__THINKWORK_IFRAME_STATE_PROXY__` for state-read/state-write. |
| **U11.5b** AppletMount production cutover | `apps/computer/src/applets/mount.tsx` rewritten — `IframeAppletMount` is the default, `LegacyAppletMount` runs only when `loadModule` is supplied (test seam) or `import.meta.env.VITE_APPLET_LEGACY_LOADER === "true"` (rollback flag). Legacy loader moved to `apps/computer/src/applets/_testing/legacy-loader.ts`. |
| **U13b** PromptInput composer migration | `ComputerComposer` (empty-thread) and `FollowUpComposer` (in-thread) rewritten to AI Elements `<PromptInput>`. Both consume `useComposerState`. Tests upgraded with `waitFor` for the async Promise.all submit chain. |
| **U14b** renderTypedPart consumer wiring | `TaskThreadView`'s `TranscriptSegment` branches on `streamState.parts.length > 0` → `renderTypedParts(parts)` wrapped in landmark `<article>` with the streaming indicator. Falls back to legacy `StreamingMessageBuffer` for `{text}` envelopes. |
| **Deploy: scripts/build-computer.sh** | Reads new sandbox terraform outputs, builds iframe-shell with `VITE_SANDBOX_IFRAME_SRC` + `VITE_ALLOWED_PARENT_ORIGINS`, syncs host bundle (excluding `iframe-shell/*`) and the iframe-shell bundle (to the sandbox bucket) with separate CloudFront invalidations. Conditional on sandbox provisioning per stage. |
| **CSP wiring** | `terraform/modules/thinkwork/main.tf` passes `inline_response_headers` to **both** `computer_site` (host CSP — `script-src 'self'`, `frame-src` allowlists sandbox, `frame-ancestors 'none'`, AppSync + Cognito `connect-src`) and `computer_sandbox_site` (iframe CSP — `connect-src 'none'`, `frame-ancestors` mirrors parent allowlist). Both CSPs derive from named locals. New outputs (`computer_sandbox_*`) so `build-computer.sh` can read them. |

## Deferred to follow-up PRs

| Item | Why deferred | Owner |
|---|---|---|
| **Playwright CSP enforcement smoke** (`scripts/smoke-csp-violation.mjs`) | Requires Playwright in `apps/computer/devDependencies` + a real deploy to run against. | Smoke/U10 |
| **iframe-shell-side `useAppletAPI` re-export** (so fragments call `useAppletAPI()` and route via `__THINKWORK_IFRAME_STATE_PROXY__`) | The proxy is in place on `globalThis`; the `@thinkwork/computer-stdlib` re-export update is a separate PR against that package. Until it lands, fragments calling `useAppletAPI` see the legacy in-process implementation. | Stdlib follow-up |
| **Iframe-shell bundle size budget tuning** (current: ~1.5MB gzipped due to react-leaflet + recharts + lucide) | Follow-up `manualChunks` config or lazy-import the heavy libs. Doesn't block v1 — the bundle does load and run end-to-end. | Perf follow-up |
| **Pre-existing zod-resolver typecheck error** in `ScheduledJobFormDialog.tsx` (Zod v4 vs `@hookform/resolvers` v5.2.2 — reproduces before any plan-012 changes) | Not introduced by plan-012; tracked separately. | Maintenance |

## Operational notes

- **Worktree:** `.claude/worktrees/computer-ai-elements-adoption` on
  branch `codex/computer-ai-elements-adoption`. Diverges from
  `origin/main` by 14 commits (one per unit + 1 status pin + 1
  contract correction).
- **Hand-rolled migration apply:** `psql "$DATABASE_URL" -f
  packages/database-pg/drizzle/0082_messages_parts_jsonb.sql`
  against dev immediately after U7 merges or the next deploy fails
  the `pnpm db:migrate-manual` drift gate.
- **AGGREGATE TEST STATE at end of session:** 319 computer tests +
  48 strands tests + 2487 api tests (previously) + 16 cli fixture
  tests all green.
- **Reviewer corrections landed in this session:** Codex flagged a
  contract bug (id-based legacy detection) and a CSP gap (no
  frame-ancestors on the iframe distribution); both corrected in
  `6d4537e2` and reflected throughout U4–U14 code paths.
- **Architectural posture (load-bearing — DO NOT regress):**
  parent → iframe `targetOrigin: "*"` is REQUIRED under
  `sandbox="allow-scripts"` (no `allow-same-origin`). Trust mechanism
  is pinned src + iframe-side build-time `__ALLOWED_PARENT_ORIGINS__`
  allowlist + per-iframe channelId nonce + no-secrets-in-payload
  invariant (recursive walk in `assertNoSecretsInPayload`). U10
  regression test pins `targetOrigin === "*"` against every
  outbound `postMessage`.
