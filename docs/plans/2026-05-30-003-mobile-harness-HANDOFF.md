# Mobile on-device harness — HANDOFF (2026-05-30)

**Read this first.** Single source of truth for picking up the mobile Pi-inspired
harness work. Companion docs: `2026-05-30-001-feat-mobile-harness-extensions-plan.md`
(the plan) and `2026-05-30-002-mobile-harness-testing-and-handoff.md` (testing detail).

---

## TL;DR for the next process

The on-device harness **works end-to-end and is calling tenant MCP tools live** (verified
in the iOS sim: "What's my name?" pulled real CRM opportunities through the proxy). The
extension architecture + MCP proxy + image input + composer UI are all shipped or in an
open PR. **Three known bugs remain** — one needs a plan, two are bounded. Details below.

### Git state at handoff
- Branch: `feat/mobile-composer-ui` → **PR #1863 (OPEN)**: https://github.com/thinkwork-ai/thinkwork/pull/1863
- Working tree: clean. All commits pushed. 72 agent tests green.
- Already merged to `main`: **PR #1862** (U1–U4 core: extension seam, MCP proxy, MCP-tools
  extension, image-in-turn). The `mcp-proxy` Lambda is **deployed and live on the dev gateway**.
- iOS sim: a **dev-client rebuild was done** (`expo run:ios`) so `expo-image-picker`'s
  native module is present. Metro hot-reload works from this worktree. Booted sim UDID seen:
  `EC60373F-DFCC-4F30-AA7D-D0D4454E6359`. **idb tap/type is BROKEN on this machine** (pyexpat) —
  a human drives the sim; the agent can only `simctl` screenshot.

---

## What's DONE (shipped or in PR #1863)

**Merged to main (PR #1862):**
- **Extension seam** (`apps/mobile/lib/agent/extensions/`) — Hermes-pure mirror of Pi's
  `ExtensionAPI` (`registerTool` + `on(event)` bus + `before_agent_start` system-prompt
  composition). `createAgentSession({ extensions })` loads them; tools additive.
- **MCP proxy** (`packages/api/src/handlers/mcp-proxy.ts` + `lib/mcp-client-call.ts`) —
  `POST /api/mcp/tools/{list,call}`, Cognito idToken, tenant-by-email, reuses
  `buildMcpConfigs`, full MCP session lifecycle (initialize handshake + Mcp-Session-Id).
  Registered in handlers.tf (both places) + build-lambdas.sh.
- **MCP tools as the first extension** (`extensions/mcp-tools-extension.ts`) — wired into
  `runThreadHarnessTurn`; both screens pass `agentId`.
- **Image input core** — `thread-turn` forwards `images`; `launchCamera` + `launchImagePicker`
  (lazy-loaded, crash-safe).

**In PR #1863 (composer UI — NEEDS on-device validation before merge):**
- Attach (paperclip) + agent toggle (Bot) on BOTH home + thread composers.
- Pending-image chip; image-or-text send gate.
- Removed the experimental "+" workspace button.
- Composer style matched to desktop (uniform 24px icons, borderless space picker).
- **Fix: new threads now create in the real Default space, not "General"** (client-side
  slug/name heuristic mirroring desktop `SpacesWorkbench.isDefaultSpace`; the Space GraphQL
  type has NO `isDefault` field — do not add it to the query, codegen rejects it).

---

## REMAINING WORK (in priority order)

### 1. Workspace context — the "What's my name?" bug  ← BIGGEST, needs /ce-plan
**Symptom:** agent answers identity/context questions wrong ("I don't have access to your
name") because the on-device harness runs with only a **bare base system prompt** — it never
loads the user's rendered S3 workspace (USER.md / MEMORY / AGENTS.md) the way the cloud agent
does.

**Cloud reference (how it's done right):**
- `packages/api/src/handlers/chat-agent-invoke.ts` → `renderWorkspaceTupleForInvoke()` calls
  the **workspace-renderer Lambda** (`WORKSPACE_RENDERER_FUNCTION_NAME`) to render the
  tenant/user/space tuple to an S3 prefix, then the runtime fetches `/api/workspaces/files`
  at bootstrap. See the comment at chat-agent-invoke ~line 764 about `workspace_tenant_id` —
  when it's empty the container skips the composer fetch and the agent "answered from stale
  default workspace content + a hallucinated identity." **That is exactly this bug, on mobile.**
- Composer lib: `packages/api/src/lib/workspace-renderer/` (`compose-tuple.ts`,
  `agents-md-composer.ts`, `repository.ts`, `s3-store.ts`).

**Decision needed (the reason this is /ce-plan, not a patch):**
- **Option A — server injects:** extend `model-converse` (or a new endpoint) to render +
  inject the agent's workspace context server-side given `agentId`, returned as the system
  prompt the device uses.
- **Option B — device fetches:** new endpoint returns the rendered workspace context; the
  harness uses it as `systemPrompt` (keeps the device composing its turn — more Pi-faithful).
- Either way: how/when to render per turn, caching, and the USER.md identity specifically.
- User explicitly asked to **/ce-plan this** before building.

### 2. Sticky "Working…" indicator — bounded, ready to build
**Symptom:** "Working… 5s" stays visible AFTER the assistant answer has already rendered.

**Desktop already solved this — PR #1864.** Apply the same principle to mobile:
- Keep the optimistic "working" state alive after the user message persists.
- Do NOT clear it just because the first durable object arrived; clear only when the **next
  durable state replaces it** (turn row / assistant message) or an **error is surfaced**.
- Surface background failures separately so optimistic routing doesn't hide them.
- Reference impl: `apps/spaces/src/lib/pending-thread-starts.ts`,
  `SpacesWorkbench.tsx`, `SpacesThreadDetailRoute.tsx`; autopilot-status note
  "Desktop Local Pi Optimistic Routing + Performance Telemetry - 2026-05-30".
- Mobile mechanism today: `apps/mobile/lib/hooks/use-turn-completion.tsx`
  (`markThreadActive`/`clearThreadActive`/`isThreadActive`) + the `ActivityTimeline`
  `ListFooterComponent={isAgentRunning ? <TypingIndicator/> : null}`. The thread screen's
  `handleSend` currently `markThreadActive` before the turn and `clearThreadActive` in a
  `finally` — the bug is likely the synchronous on-device turn clears it on its own settle
  while a re-fetch/late durable write is still in flight, OR the AUTO_CLEAR/subscription path
  races. Investigate the lifecycle against the desktop pattern; do NOT just shorten timers.

### 3. iOS native build / EAS gotchas (operational, not a bug)
- Adding any native module (like `expo-image-picker`) requires a **dev-client rebuild**
  (`expo run:ios`) or a fresh TestFlight build — JS reload is not enough. Imports of native
  modules must be **lazy** (see `tools/image-picker.ts`) so a stale binary degrades instead
  of black-screening the app.
- **EAS Node pin** (`eas.json` production/preview) must be ≥ the highest `engines.node` in the
  whole workspace (currently 22.19.0). Fails ONLY on EAS, at "Install dependencies", if drifted.

---

## U5 verification status (live)
- **Tool path: PROVEN in sim** — message → on-device harness → mcp-proxy → tenant MCP → answer
  with real CRM data. Watch logs:
  `/aws/lambda/thinkwork-dev-api-{model-converse,mcp-proxy,record-turn}` (note the `-api-`
  infix; mcp-proxy group exists only after first invocation).
- **Camera + business-card→CRM: NOT yet** — sim has no camera; needs TestFlight.
  Build: `cd apps/mobile && EAS_BUILD_NO_EXPO_GO_WARNING=true npx -y eas-cli@latest build
  --platform ios --profile production --non-interactive --no-wait --auto-submit`
  (EAS must be logged into the `thinkwork-ai` account, not `homecareintel`).

---

## Process notes / landmines for the next agent (learned the hard way this session)
- **Bracketed/paren paths garble in Read/sed/awk** (`app/(tabs)/index.tsx`,
  `app/thread/[threadId]/index.tsx`). Copy to a clean `/tmp/x.tsx` to read; `grep -c` and the
  Edit tool are reliable on the real path. Don't "diagnose corruption" from garbled Read output.
  (Memory: `feedback_bracketed_path_tool_rendering`.)
- **apps/mobile has NO `typecheck` script** — CI won't catch TS errors there. Run
  `cd apps/mobile && npx tsc --noEmit` manually before committing TSX changes. One pre-existing
  error is known/benign: `(tabs)/index.tsx` `agentName: selectedComputer?.name` (string|null vs
  string|undefined) — exists on main, not yours.
- **Never commit on a failed codegen/test.** A broken `isDefault` query was committed+pushed
  this session despite codegen exit=1, then force-fixed. Check exit codes.
- Don't batch many edits to one file in a single turn — stale-state Edit failures cascade.
  Re-read between edits.
- The composer is `MessageInputFooter` (`apps/mobile/components/input/`), used by BOTH
  `app/(tabs)/index.tsx` (home "Start a new thread") and `app/thread/[threadId]/index.tsx`
  (open thread). Changes usually need to touch both callers.
