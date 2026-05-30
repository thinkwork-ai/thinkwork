# Mobile harness extensions — testing & handoff notes

Created: 2026-05-30
Companion to: `docs/plans/2026-05-30-001-feat-mobile-harness-extensions-plan.md`

This is the pick-up-where-we-left-off doc for the next agent. It captures (1) exactly
what shipped, (2) the in-flight U4-UI work and its risks, and (3) detailed steps to
validate in the iOS simulator and via TestFlight.

---

## 1. What shipped to `main` (PR #1862, merged + deployed)

The full **logic** path of the Pi-style extension model is on main and the U2 proxy is
**live on the dev gateway** (Deploy succeeded):

- **U1 — extension seam** (`apps/mobile/lib/agent/extensions/`): Hermes-pure mirror of
  Pi's `ExtensionAPI` (`registerTool` + `on(event)` event bus + `logger`); `defineExtension`;
  `load-extensions` (event bus + tool registry; `before_agent_start` handlers chain to
  compose the system prompt; a throwing register is logged + skipped). `createAgentSession({ extensions })`
  loads once via a memoized `ready()` promise that `prompt()` awaits — synchronous surface
  preserved; extension tools additive (built-ins never dropped).
- **U2 — server-side MCP proxy** (`packages/api/src/handlers/mcp-proxy.ts` +
  `packages/api/src/lib/mcp-client-call.ts`): `POST /api/mcp/tools/{list,call}`, Cognito-authed,
  tenant-by-email, reuses `buildMcpConfigs` (per-user OAuth refresh, no device secrets),
  `agentId` in body validated to caller's tenant. The client runs the **full MCP session
  lifecycle** (initialize → notifications/initialized → request, carrying `Mcp-Session-Id`)
  so spec-strict streamable-HTTP servers accept it; handles JSON + SSE. Registered in BOTH
  the `handlers.tf` toset AND `local.api_routes` + `build-lambdas.sh` (the omission that
  broke main in #1831/#1832 — verified).
- **U3 — MCP tools as the first extension** (`extensions/mcp-tools-extension.ts`): discovers
  the agent's tenant tools via the proxy (idToken), registers each as a flat harness Tool
  (proxy-backed execute; upstream `isError` + transport throw both become recoverable error
  tool-results), adds a `before_agent_start` fragment naming the connected tools. Discovery
  failure / no tools → registers nothing, turn runs as plain chat. Wired into
  `runThreadHarnessTurn`; both thread screens pass `agentId`.
- **U4 core — image input**: `thread-turn` accepts `images?: ImagePart[]` and forwards them
  on the user turn (`session.prompt(userText, images)`); `launchCamera` added beside
  `launchImagePicker`. app.json already had `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription`.

Test counts at merge: **72 agent tests** (`apps/mobile`) + **25 api tests** (`packages/api`), all green; api typecheck clean.

---

## 2. In-flight: U4 UI (composer parity) — UNCOMMITTED / NEEDS VERIFICATION

> **STATUS: incomplete and unverified. Do not assume it builds.** Autopilot was stopped
> mid-edit. Treat the working-tree changes as a draft to finish, not as done.

The goal was to bring the mobile composer (`apps/mobile/components/input/MessageInputFooter.tsx`)
to parity with the desktop spaces composer (`apps/spaces/src/components/workbench/SpacesComposer.tsx`),
whose toolbar (left→right) is: **agent toggle (Bot, blue `#54a9ff` when on) · runtime indicator ·
attach (paperclip) · space picker (planet "Default") · (right) mic · send**.

User decisions for the mobile composer v1:
- **Add**: attach (paperclip → Library/Camera → image), agent toggle (Bot), real send+mic
  (already worked), space/model picker (already present).
- **Remove**: the quick-action lightning (`Zap`) button.

### Edits made to the working tree (verify each before committing)

**`apps/mobile/components/input/MessageInputFooter.tsx`** (believed complete):
- Imports: added `Image` (react-native) and `Paperclip`, `Bot`, `X` (lucide); removed `Zap`.
- New props: `onAttach`, `attachedImageUri`, `onRemoveAttachment`, `agentEnabled`, `onToggleAgent`.
- Removed props: `onQuickActions`, `quickActionsDisabled`.
- Added: pending-image chip (64×64 thumbnail with an X remove button) above the text input.
- Added: Bot toggle (blue when `agentEnabled`) + Paperclip attach button in the left toolbar;
  removed the Zap button.
- `canSubmit` now true when there's text **or** an attached image (image-only turn valid).

**`apps/mobile/app/thread/[threadId]/index.tsx`** (PARTIALLY applied — RISKS BELOW):
- Added state: `attachedImage` (`ImagePart | null`), `attachedImageUri` (`string | null`),
  `agentEnabled` (`boolean`, default true).
- Added `handleAttach` (Alert with Photo Library / Camera → `pickImage(launchImagePicker|launchCamera)`).
- `handleSend` now: reads `attachedImage`, sends `agentId` (gated by `agentEnabled`) and
  `images`, clears attachment after send; deps updated to include `attachedImage` + `agentEnabled`.
- `MessageInputFooter` usage updated to pass the new props; `onQuickActions` removed.

### KNOWN RISKS the next agent MUST resolve (these are why it's unverified)

1. **Missing imports in the thread screen.** `handleAttach` uses `pickImage`, `launchImagePicker`,
   `launchCamera`, and the state uses `ImagePart`, plus `Alert`. These imports were NOT confirmed
   added. Add:
   - `import { pickImage } from "@/lib/agent/capture-image";`
   - `import { launchImagePicker, launchCamera } from "@/lib/agent/tools/image-picker";`
   - `import type { ImagePart } from "@/lib/agent/types";`
   - ensure `Alert` is imported from `react-native`.
2. **`agentId` wiring may have regressed.** During the session the committed U3 `agentId` line
   in the thread screen got tangled (an edit matched a pre-U3 block). VERIFY the merged main
   version: `git show origin/main:"apps/mobile/app/thread/[threadId]/index.tsx" | grep -n agentId`
   — main DOES have `agentId: thread?.agentId ?? undefined` (confirmed at handoff). Make sure
   the working-tree `handleSend` ends up with `agentId: agentEnabled ? (thread?.agentId ?? undefined) : undefined`
   and `images: image ? [image] : undefined`, not a stale duplicate.
3. **Dead `onQuickActions` prop on the OTHER caller.** `apps/mobile/app/(tabs)/index.tsx` (the
   new-thread composer, ~line 1171) still passes `onQuickActions={...}` to `MessageInputFooter`.
   Since the prop was removed from the component's interface, this is a **TS error**. Either
   remove that prop from the `(tabs)` caller, or decide whether the new-thread composer should
   get the same attach/agent-toggle treatment (it's a different surface — workspace/space
   picker driven). Minimum to make it green: drop the `onQuickActions` prop there. The
   `QuickActionsSheet` + `quickActionsRef` in `(tabs)` can stay or be removed; if the Zap button
   is gone everywhere, the sheet is unreachable and should be cleaned up in a follow-up.
4. **Git branch state.** PR #1862 squash-merged and the remote branch was deleted. The local
   `feat/mobile-harness-extensions` branch is now BEHIND main (main has the squash commit).
   Recommended: stash the U4-UI working changes, `git checkout -b feat/mobile-composer-ui origin/main`
   (fresh off updated main), pop the stash, finish + verify, then PR. Do NOT try to reuse the
   old merged branch.

### To finish U4 UI (suggested order)
1. New branch off `origin/main`; bring the working-tree edits over (or re-apply from this doc).
2. Add the missing imports (risk #1).
3. Fix the `(tabs)` caller (risk #3).
4. Add a `MessageInputFooter` interaction test if practical (RN Testing Library), or rely on
   sim validation — the footer is presentational.
5. `cd apps/mobile && npx vitest run lib/agent` → green (72+).
6. Prettier-write changed files. Commit. PR. (apps/mobile has no `typecheck` script, so CI
   won't catch the `(tabs)` TS error — catch it locally with a manual `tsc` or careful review.)

---

## 3. Remaining plan units

- **U4 UI** — the above (composer attach button + agent toggle + image chip). Validate on device.
- **U5** — live end-to-end verification (sim + TestFlight). See §4/§5 below.
- **Streaming** — its own `/ce-plan` (user decision). Reworks `model-converse` (single
  request/response today → `ConverseStream` + SSE/chunked) + `BedrockModelProvider` + loop
  partial-text events. Not started.
- **Tool-call activity in the turn** — render `tool_call`/`after_tool_call` inline (desktop
  parity). U1's event bus defines these; needs loop dispatch + a thread renderer. Not started.
- Deferred from plan-001: `packages/pi-hermes` extraction (after a 2nd extension), per-agent
  tool-policy parity, single-`mcp()`-proxy-tool shape (pi-mcp-adapter fork).

---

## 4. How to test in the iOS Simulator (fast loop)

The sim runs this worktree's code over Metro and hits the **dev gateway** (`ho7oyksms0`),
where the U2 `mcp-proxy` is live. This is the primary loop for U4 UI + U5 (tools + library-image).

**Caveats:**
- The sim has **no camera** — `launchCamera`/business-card-photo can only be fully validated on
  a physical device (TestFlight, §5). In the sim, test the **Photo Library** path.
- `idb` tap/describe is BROKEN on this machine (pyexpat dylib). The agent can `xcrun simctl`
  screenshot but **cannot tap/type** — the human drives the sim. `mcp__ios-simulator__*`
  `ui_tap`/`ui_describe` also fail (same idb dependency); `screenshot` works.

**Setup:**
1. `cd apps/mobile && pnpm start` (Metro), then press `i` (or `pnpm ios`) to launch the sim.
   Existing booted sim UDID seen this session: `EC60373F-DFCC-4F30-AA7D-D0D4454E6359`.
2. Sign in with the dev Google account (same backend the harness uses).

**What to validate (U4 UI + U5 tool path):**
1. **Composer parity (U4 UI):** open a thread. Confirm the toolbar shows **Bot toggle**,
   **paperclip**, (space picker), mic, send — and **no lightning/Zap** button. Bot is blue when on.
2. **Image attach (library):** tap paperclip → "Photo Library" → pick an image → a 64×64 chip
   appears above the input with an X to remove. Send is enabled with an image even if text empty.
3. **Image → vision turn (U5):** attach a business-card-like image + "create an opportunity from
   this card" → send. Watch logs (below): `model-converse` should show the turn; if the tenant
   has a suitable MCP tool, `mcp-proxy` shows `tools/call` and the answer reflects it.
4. **Tool path without image (U5):** in a thread whose agent has tenant MCP tools, send a message
   that needs a tool (e.g. "search the CRM for Acme"). Confirm `mcp-proxy` `tools/list` then
   `tools/call`, and `model-converse` `toolCalls > 0`.
5. **Agent toggle off:** turn the Bot off, send → the turn should run with `agentId` undefined
   (no platform tools; plain chat). Confirm no `mcp-proxy` call fires.
6. **Working… indicator** covers the multi-step (tool) turn and clears on completion.

**Watching the live logs (agent has AWS CLI access):**
```
# model-converse (inference; toolCalls>0 proves the tool path)
aws logs filter-log-events --region us-east-1 \
  --log-group-name /aws/lambda/thinkwork-dev-api-model-converse \
  --start-time $(( ($(date +%s) - 600) * 1000 )) \
  --query 'events[*].message' --output text | tail -30

# mcp-proxy (tools/list + tools/call for the caller's tenant)
aws logs filter-log-events --region us-east-1 \
  --log-group-name /aws/lambda/thinkwork-dev-api-mcp-proxy \
  --start-time $(( ($(date +%s) - 600) * 1000 )) \
  --query 'events[*].message' --output text | tail -30

# record-turn (turn persisted into the thread)
aws logs filter-log-events --region us-east-1 \
  --log-group-name /aws/lambda/thinkwork-dev-api-record-turn \
  --start-time $(( ($(date +%s) - 600) * 1000 )) \
  --query 'events[*].message' --output text | tail -30
```
Note: log group names are `thinkwork-dev-api-<handler>` (the `-api-` infix — NOT
`thinkwork-dev-<handler>`). `mcp-proxy`'s group only exists after its first invocation.

**Prereq for the tool path:** the caller's tenant/agent must actually have an MCP server
configured + approved (`agent_mcp_servers` ⋈ `tenant_mcp_servers`, status approved, enabled).
If `tools/list` returns empty, the agent correctly runs as plain chat — to truly exercise U5
you need a tenant with a connected MCP tool. Verify with a direct curl of the deployed proxy
using a real idToken before blaming the client.

---

## 5. How to test on a physical device (TestFlight)

Needed to validate **camera capture** (the sim has none) and real touch/permission behavior.

**Cut the build (agent is now Owner on the `thinkwork-ai` EAS account):**
```
cd apps/mobile
EAS_BUILD_NO_EXPO_GO_WARNING=true npx -y eas-cli@latest build \
  --platform ios --profile production --non-interactive --no-wait --auto-submit
```
- `appVersionSource: remote` + `autoIncrement` bumps the build number automatically.
- `submit.production` is configured (appleId `eric@thinkwork.ai`, ascAppId `6772342918`,
  team `DKPQ8HN449`); `--auto-submit` queues TestFlight submission.
- **EAS Node pin gotcha** (`[[project_eas_node_pin_workspace_floor]]`): `eas.json` `production`/`preview`
  must pin Node ≥ the highest `engines.node` in the WHOLE workspace (currently `22.19.0` — bumped
  because `@earendil-works/pi-coding-agent` requires it). If a workspace package raises its floor
  again, bump `eas.json` or the build fails at "Install dependencies" with `ERR_PNPM_UNSUPPORTED_ENGINE`
  (this fails ONLY on EAS, not locally). Verify before building.
- Watch the build; on FINISHED it auto-submits. Apple processing ~5–30 min before it appears in TestFlight.

**On device, validate (in addition to the sim checks):**
1. **Camera capture:** paperclip → "Camera" → take a photo of a real business card → chip appears → send.
2. **Business-card → CRM (the headline U5 flow):** the model reads the card via vision and calls
   the tenant's create-opportunity/CRM MCP tool with extracted fields; the result renders in-thread
   and persists. Confirm via the same CloudWatch logs (§4).
3. **Permission prompts:** first camera/library use shows the iOS permission dialog with the
   strings from app.json — confirm they read sensibly.
4. **Real composer feel:** toolbar layout, attach chip, agent toggle, send all behave with real
   touch/keyboard.

**Build-number context (this session's history):** builds 11–15 were the earlier harness
work; the next build is whatever `autoIncrement` produces. Don't hand-set it.

---

## 6. Process notes for the next agent (lessons from this session)

- The thread screen `apps/mobile/app/thread/[threadId]/index.tsx` has a path with `[threadId]`
  brackets that **break shell globbing and some grep invocations** — quote it always, and prefer
  the Read/Edit tools over shell `sed`/`grep` on it.
- Several edits this session silently failed because `old_string` matched a block that had
  already drifted from earlier edits. **Re-Read before each Edit on a file you've already edited
  this turn**, and don't batch many edits to the same file in one message.
- `apps/mobile` has **no `typecheck` script**, so CI does not catch TS errors there. A dead prop
  on a typed component (like the `(tabs)` `onQuickActions`) will ship unless caught locally.
- Validate-before-commit; never commit red. (One red commit happened this session and was amended.)
