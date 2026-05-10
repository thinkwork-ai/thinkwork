---
title: "Status: feat: Computer LLM-UI adopts Vercel AI SDK end-to-end"
plan: docs/plans/2026-05-09-012-feat-computer-ai-elements-adoption-plan.md
status: in-flight
date: 2026-05-09
---

# Plan-012 implementation status

This is the autopilot status pin for the AI Elements + iframe-substrate
adoption plan. The plan body is the decision artifact and is never
edited; this file tracks unit-by-unit shipping state across sessions.

## Shipped (commits on `codex/computer-ai-elements-adoption`)

| Unit | Commit | Notes |
|---|---|---|
| **U1** Contract spec | `e4cc17be`, `6d4537e2` | `docs/specs/computer-ai-elements-contract-v1.md`. Plan-001 banner pointer added. Reviewer correction landed: legacy `{text}` detection is shape-based, not id-based; iframe CSP gains `frame-ancestors` allowlist. |
| **U2 prep** Primitive + cn shim | `d5d718d8` | `@thinkwork/ui` exports `accordion`, `button-group`, `hover-card` via wildcard `./*` subpath. `apps/computer/src/lib/utils.ts` re-exports `cn`. The full AI Elements component install (12 `.tsx` files + their motion / nanoid / shiki / use-stick-to-bottom / @streamdown/* deps) is quarantined in `.work-in-progress/u2-ai-elements/` pending a focused install pass — see Deferred below. |
| **U3** Sandbox subdomain Terraform (inert) | `a451e33f` | `terraform/modules/app/static-site` extended with optional `response_headers_policy_id` / `inline_response_headers` inputs (mutually exclusive, fully backwards-compatible). New `module "computer_sandbox_site"` instance gated on `var.computer_sandbox_domain` ships the iframe CSP profile from contract v1. Bucket empty until U9's deploy wiring lands. 16 fixture tests + `terraform validate` pass. |
| **U4** useChat AppSync transport (inert scaffold) | `c2fd9d23` | `apps/computer/src/lib/use-chat-appsync-transport.ts`, chunk parser with shape-based legacy detection, types module, body-swap forcing-function test asserting `ComputerThreadDetailRoute` does not yet import the adapter. Single-submit invariant pinned by 12 tests. |
| **U5** Strands UIMessage publisher (inert scaffold) | `2457999b` | `packages/agentcore-strands/agent-container/container-sources/ui_message_publisher.py` with `make_ui_message_publisher_fn` factory closure, per-Computer-thread `ui_message_emit` capability flag (default False — non-Computer agents inherit legacy `{text}` shape), validator + emitter helpers. 24 tests. `_boot_assert.EXPECTED_CONTAINER_SOURCES` extended. |
| **U6** Activate typed emission for Computer threads + per-part-id cursor | `f7da90e4` | server.py wires UIMessagePublisher alongside the legacy AppSyncChunkPublisher when `ui_message_emit=True` (set when `computer_id and computer_task_id`). Drops the `seq < highest - 2` heuristic. New `apps/computer/src/lib/ui-message-merge.ts` implements per-part-id append cursor; `useComputerThreadChunks` exposes both legacy `chunks` and typed `streamState`. 14 merge tests + 28 parser tests + 24 publisher tests + 7 boot_assert tests + all 256 computer tests still green. |
| **U7** `messages.parts` jsonb + GraphQL field + tenant audit | `1d8e7410` | Hand-rolled migration `drizzle/0082_messages_parts_jsonb.sql` with `-- creates-column: public.messages.parts` marker. Drizzle schema + GraphQL type updated. **Closes a pre-existing P0 cross-tenant exposure**: prior to this PR, `Query.messages` and `Thread.messages` filtered by `thread_id` alone with no tenant gate. Both resolvers now scope by `resolveCallerTenantId(ctx)` + thread/computer ownership. 5-test regression suite pins the gate (foreign tenant returns empty page; no-tenant caller returns empty page). All 4 codegen consumers regenerated; 2471 api tests still green. **Manual psql -f required against dev after merge** per `feedback_handrolled_migrations_apply_to_dev`. |
| **U9** Iframe-shell bundle (inert) | `801a0ee1` | `apps/computer/src/iframe-shell/{main.ts, index.html, iframe-protocol.ts, iframe-content-scan.ts, __tests__/}`. Vite config `vite.iframe-shell.config.ts` emits a separate 36KB bundle. Build-time defines `__ALLOWED_PARENT_ORIGINS__` and `__SANDBOX_IFRAME_SRC__`. Protocol envelope types + helpers (newChannelId, buildEnvelope, validateInboundEnvelope) carry the load-bearing security invariants: shape-and-channelId gate on inbound, `assertSafeAllowlist` rejects "null"/"\*", `assertNoSecretsInPayload` rejects credential field names. 32 tests pass. Inert: no parent code mounts the iframe yet (U10), and `scripts/build-computer.sh` is NOT yet modified to deploy the bundle to the sandbox bucket. |

## Deferred (scoped follow-ups; not yet shipped)

These units depend on U2 completion (full AI Elements install) or build
on top of the iframe substrate. Each is independently mergeable.

| Unit | Blocker / dependency | Scope summary |
|---|---|---|
| **U2 completion** | External deps (`pnpm add motion nanoid shiki use-stick-to-bottom @radix-ui/react-use-controllable-state @streamdown/{cjk,code,math,mermaid}` + `pnpm --filter @thinkwork/ui add react-resizable-panels`); audit pre-existing `.work-in-progress/u2-ai-elements/*.tsx` for import correctness; install-smoke test. | Move quarantined files back to `apps/computer/src/components/ai-elements/`; wire `apps/computer/components.json`; verify `pnpm --filter @thinkwork/computer build` size delta within budget. |
| **U8** Thread surface adopts useChat + Conversation/Message/Response | U2 complete + U6 ✅ + U7 ✅ | Replace manual subscription wiring in `ComputerThreadDetailRoute.tsx` with `useChat({ transport: createAppSyncChatTransport(...) })`. Adopt `<Conversation>`, `<Message>`, `<Response>`, `<Reasoning>`. Delete the U4 inert-seam test. |
| **U10** AppletMount becomes iframe renderer/controller + protocol live + theme + CSP smoke | U9 ✅ | Build `apps/computer/src/applets/iframe-controller.ts` (`IframeAppletController` class). Wire postMessage protocol (init, ready, theme, resize, callback, state-read/write, error). Add `scripts/smoke-csp-violation.mjs` (Playwright). Wire `terraform/modules/thinkwork/main.tf` to attach response-headers policies. Modify `scripts/build-computer.sh` to deploy iframe-shell bundle. |
| **U11** Cut over inline + canvas applet mount paths to iframe runtime | U10 | Production cutover. Legacy same-origin loader gated behind `VITE_APPLET_LEGACY_LOADER`. |
| **U12** `<Artifact>` chrome wraps canvas + inline applet surfaces | U2 complete + U11 | Visual chrome wrapper. |
| **U13** Composer migration to `<PromptInput>` (single-submit invariant) | U2 complete + U8 | Both empty-thread and in-thread composers share `useComposerState(threadId)`. P0 regression test asserts no direct turn-start mutation calls. |
| **U14** Typed parts light up — `<Reasoning>`, `<Tool>`, `<CodeBlock>` | U2 complete + U6 ✅ + U8 | Render `tool-${name}` parts via `<Tool>`. Delete `actionRowsForMessage`. |

## Operational notes

- **Worktree:** `.claude/worktrees/computer-ai-elements-adoption` on
  branch `codex/computer-ai-elements-adoption`. Origin/main parent
  commit at the time of writing: `c920e100` (the plan body itself).
- **Hand-rolled migration:** apply `psql -f
  packages/database-pg/drizzle/0082_messages_parts_jsonb.sql` to dev
  immediately after U7 merges or the next deploy fails the
  `pnpm db:migrate-manual` drift gate.
- **AI Elements quarantine:** `.work-in-progress/u2-ai-elements/`
  holds the in-progress AI Elements components. The full U2 install
  is a focused multi-step pass — install missing external deps,
  audit each `.tsx` for import correctness against the now-installed
  `@thinkwork/ui` primitives, then move them back into
  `apps/computer/src/components/ai-elements/`.
- **Reviewer note from this session:** U1 had a contract bug (treated
  legacy `{text}` detection as id-based instead of shape-based) and a
  CSP gap (no `frame-ancestors` on the iframe distribution).
  Corrected in `6d4537e2` and reflected throughout U4–U6 + U9 code.
