# Compounding Memory — Mobile Memories Quick-Capture PRD

**Status:** Draft · 2026-04-18
**Owner:** Eric
**Audience:** Coding agent (implementation spec)
**Platform:** React Native / Expo iOS first, Android later
**Siblings:**
- `.prds/compounding-memory-mobile-memories-ui-prd.md`
- `.prds/compounding-memory-mobile-memories-force-graph.md`

**Related:**
- `.prds/compounding-memory-company-second-brain-prd.md`
- `.prds/compiled-memory-layer-engineering-prd.md`
- `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md`

---

## 1. Overview

### Problem

The Memories tab footer ("Add new memory…") in `apps/mobile/app/(tabs)/index.tsx:544-557` is scaffolded but unwired. Users need a fast way to save a thought — "I was just told something, write it down for later" — into the **currently selected agent's** memory without triggering an agent turn or leaving the tab.

### Supersedes earlier design

The sibling UI PRD originally routed this footer into `wiki_unresolved_mentions` via a `captureManualMemory` mutation. That path was semantically wrong:

- `wiki_unresolved_mentions` is the compile pipeline's staging table for **low-confidence candidate entity names** — raw strings the compile pass extracted but wasn't confident enough to promote into a page.
- A user typing "Kira leads the infra team" is a **world fact**, not a candidate entity name.
- Compile writes to the wiki; compile reads from Hindsight. The correct upstream for user-authored facts is Hindsight, not the wiki staging layer.

This PRD moves the footer to write **directly to Hindsight**. The compile pipeline can later promote these captures into Entity/Topic/Decision pages like any other Hindsight source.

### Product intent

A one-gesture save, always present, always scoped to the currently selected agent. The captured fact is:

- Immediately visible in a new **Captures** filter segment in the Memories tab.
- Recallable by the agent on the next chat turn (automatic — same Hindsight bank).
- Typed or dictated.
- Undoable for 5 seconds; deletable forever via swipe.

### Key architectural discovery

Hindsight uses **one bank per agent**, keyed by agent slug (resolved via `resolveBankId()` in `packages/api/src/lib/memory/adapters/hindsight-adapter.ts:261-283`). This means:

- "Tagged to Marco" is accomplished structurally by writing into Marco's bank — no separate tag field required.
- Marco's chat-time recall reads the same bank, so captures surface in future Marco turns automatically with zero retrieval-side plumbing.
- No user-facing GraphQL retain mutation exists today. The internal `memory-retain.ts` Lambda is IAM-only. We must add one.

### Goals

1. A user can type (or dictate) a thought, tap send, and see confirmation within 500ms without ever leaving the Memories tab.
2. A captured fact is retrievable by the associated agent during any subsequent chat turn.
3. The user can recover from typos with an Undo button visible in the confirmation toast for 5 seconds.
4. Captures work offline and sync transparently when the device reconnects.
5. The user can review recent captures in a dedicated Captures filter segment and delete any that are wrong.

### Non-goals

- Editing captures after save (delete + recapture is the only correction path).
- Multimodal captures (image/audio-as-source). Text only in v1; dictation is transcribed to text on-device via iOS dictation.
- Manual bank selection or cross-agent broadcast. One capture = one bank = one agent = the currently selected agent at capture time.
- Triggering an agent turn from this input. This is explicitly **not** a chat message.
- Admin or team-wide memory surfaces. Mobile-only, user-scoped, v1.

---

## 2. Locked decisions

Decisions made during user grill session, 2026-04-18:

| # | Decision |
|---|---|
| 1 | **Default fact_type** — `sourceType: "explicit_remember"` → Hindsight `fact_type: "world"`. Invisible default. |
| 2 | **Post-save visibility** — new **Captures** segment in the Memories filter bar **plus** toast confirmation. |
| 3 | **Lifecycle** — Undo toast (5s) + swipe-delete on capture rows. **No editing.** |
| 4 | **Voice** — existing mic button wired to iOS native dictation via `TextInput` props. No custom STT pipeline in v1. |
| 5 | **Captures list scope** — explicit user captures only, server-side filter on `metadata.capture_source === 'mobile_quick_capture'`. |
| 6 | **"+" icon** — repurposed as a **fact_type picker**. Selected type shows as a chip above the input (matches the thread composer's workspace-chip pattern). |
| 7 | **Type picker values** — all 4 Hindsight-native types: **Fact** (world) · **Preference** (opinion) · **Experience** (experience) · **Observation** (observation). |
| 8 | **Offline** — queue in AsyncStorage, sync on reconnect with exponential backoff. |
| 9 | **Size limit** — 2,000 chars hard cap, soft-warn counter color-shift at 1,500. |
| 10 | **Optimistic UI** — row appears instantly with status states: `saving → saved` / `sync_pending` / `failed`. |
| 11 | **Agent switch mid-flow** — queued captures stay bound to their capture-time agent. Draft text (not yet bound) transfers to the newly selected agent. |
| 12 | **Metadata stamped per capture** — `capture_source`, `client_platform`, `app_version`, `captured_via` (text \| dictation). |

---

## 3. Data flow

```
┌──────────────────────────────────────────────────────────────────┐
│  apps/mobile/components/memory/CaptureFooter                      │
│  - TextInput + FactTypeChip + char counter + mic + send          │
│  - iOS dictation via native TextInput props                       │
└───────────────────────────┬──────────────────────────────────────┘
                            │  onSubmit → enqueue
┌───────────────────────────▼──────────────────────────────────────┐
│  apps/mobile/lib/offline/capture-queue (AsyncStorage)             │
│  - { clientCaptureId, agentId, content, factType, metadata, ... }│
│  - Flush on NetInfo.isConnected; exp. backoff                     │
└───────────────────────────┬──────────────────────────────────────┘
                            │  useCaptureMobileMemory()
┌───────────────────────────▼──────────────────────────────────────┐
│  @thinkwork/react-native-sdk                                      │
│  - captureMobileMemory mutation (idempotent on clientCaptureId)   │
└───────────────────────────┬──────────────────────────────────────┘
                            │  GraphQL → AppSync
┌───────────────────────────▼──────────────────────────────────────┐
│  packages/api/src/resolvers/memory/captureMobileMemory.ts         │
│  - Resolves agentId → bankId via adapter                          │
│  - Calls getMemoryServices().retain({ ownerId: agentId,           │
│      sourceType: 'explicit_remember', content, role: 'user',      │
│      metadata: { capture_source, fact_type_override, ... } })     │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│  Hindsight — POST /v1/default/banks/{marcoBank}/memories          │
│  - Stores unit with content + metadata; embeds for recall         │
│  - Returns memory_unit id                                         │
└──────────────────────────────────────────────────────────────────┘
```

Chat-time read path (unchanged, automatic):
```
Agent turn → getMemoryServices().recall({ ownerId: agentId, query }) →
  POST /v1/default/banks/{marcoBank}/memories/recall →
  surfaces captured facts alongside chat-derived memories.
```

---

## 4. Data contracts

### 4.1 GraphQL (new — extends `packages/database-pg/graphql/types/memory.graphql`)

```graphql
enum MobileCaptureFactType {
  FACT          # world (default)
  PREFERENCE    # opinion
  EXPERIENCE    # experience
  OBSERVATION   # observation
}

enum MobileCaptureStatus {
  QUEUED      # offline / mid-flight
  SYNCED
  FAILED
  DELETED
}

type MobileMemoryCapture {
  id: ID!                      # Hindsight memory_unit id on sync; clientCaptureId while queued
  tenantId: ID!
  agentId: ID!
  content: String!
  factType: MobileCaptureFactType!
  status: MobileCaptureStatus!
  capturedAt: DateTime!
  syncedAt: DateTime
  metadata: JSON!
}

type MobileMemoryCapturesPage {
  edges: [MobileMemoryCapture!]!
  nextCursor: String
}

extend type Query {
  mobileMemoryCaptures(
    tenantId: ID!
    agentId: ID!
    limit: Int = 50
    cursor: String
  ): MobileMemoryCapturesPage!
}

extend type Mutation {
  captureMobileMemory(
    tenantId: ID!
    agentId: ID!
    content: String!
    factType: MobileCaptureFactType = FACT
    metadata: JSON
    clientCaptureId: ID    # idempotency key
  ): MobileMemoryCapture!

  deleteMobileMemoryCapture(
    tenantId: ID!
    agentId: ID!
    captureId: ID!
  ): Boolean!
}
```

### 4.2 Adapter payload (what actually hits Hindsight)

```json
POST /v1/default/banks/{marcoSlug}/memories
{
  "items": [
    {
      "content": "Kira leads the infra team",
      "context": "explicit_remember",
      "metadata": {
        "fact_type": "world",
        "fact_type_override": null,
        "role": "user",
        "capture_source": "mobile_quick_capture",
        "client_platform": "ios",
        "app_version": "1.4.2",
        "captured_via": "text",
        "client_capture_id": "2a7c...ee9f"
      }
    }
  ]
}
```

`fact_type_override` (new) lets the mobile resolver force the Hindsight fact_type beyond what `sourceTypeToFactType` would infer. Required for Preference (`opinion`), Experience, and Observation captures since all of them route through `explicit_remember` sourceType with `role: user`.

### 4.3 Client queue entry (AsyncStorage)

```ts
type QueuedCapture = {
  clientCaptureId: string;       // uuid v4
  tenantId: string;
  agentId: string;               // bound at capture time, immutable
  content: string;
  factType: MobileCaptureFactType;
  metadata: Record<string, unknown>;
  capturedAt: string;            // ISO 8601
  attemptCount: number;
  lastError?: string;
};
```

---

## 5. Backend changes

### 5.1 Adapter tweak

`packages/api/src/lib/memory/adapters/hindsight-adapter.ts`:
- Extend `retain()` to honor `metadata.fact_type_override` when present and matching a legal Hindsight fact_type (`world` / `experience` / `observation` / `opinion`). When set, it wins over the `sourceTypeToFactType` result.
- Preserve existing behavior for non-override callers. Internal `memory-retain.ts` still gets the inferred mapping.

### 5.2 New resolvers

- **`packages/api/src/resolvers/memory/captureMobileMemory.ts`**
  - Translates `MobileCaptureFactType` to adapter sourceType + fact_type_override:
    - `FACT` → `sourceType: 'explicit_remember'`, no override (natural mapping → world)
    - `PREFERENCE` → `sourceType: 'explicit_remember'`, `fact_type_override: 'opinion'`
    - `EXPERIENCE` → `sourceType: 'explicit_remember'`, `fact_type_override: 'experience'`
    - `OBSERVATION` → `sourceType: 'explicit_remember'`, `fact_type_override: 'observation'`
  - Stamps `capture_source`, `client_platform`, `app_version`, `captured_via` into metadata (merging any caller-provided metadata JSON last so the mobile client can override if needed).
  - Idempotency: `clientCaptureId` stored in metadata; on repeat, resolver returns the prior record instead of creating a duplicate.
  - Returns `MobileMemoryCapture` with the Hindsight memory_unit id as `id`.

- **`packages/api/src/resolvers/memory/mobileMemoryCaptures.ts`**
  - Calls `getMemoryServices().inspect({ ownerId: agentId, ... })`, filters server-side to `metadata.capture_source === 'mobile_quick_capture'`, returns newest-first paginated.

- **`packages/api/src/resolvers/memory/deleteMobileMemoryCapture.ts`**
  - Wraps existing `deleteMemoryRecord` with a scope check rejecting records that lack the `capture_source` metadata — prevents accidental deletion of chat-derived memories through this mobile-facing endpoint.

### 5.3 No migration required

Hindsight stores metadata as JSON. Adding new keys is a zero-migration operation. The `memory_units` table in `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` SQL paths requires no schema changes.

---

## 6. SDK hooks

New in `packages/react-native-sdk/src/hooks/`:

```ts
// use-capture-mobile-memory.ts
function useCaptureMobileMemory(): {
  mutate: (input: {
    agentId: string;
    content: string;
    factType?: MobileCaptureFactType;
    metadata?: Record<string, unknown>;
    clientCaptureId: string;
  }) => Promise<MobileMemoryCapture>;
  state: 'idle' | 'pending' | 'error' | 'success';
  error?: Error;
};

// use-mobile-memory-captures.ts
function useMobileMemoryCaptures(input: {
  agentId: string;
  limit?: number;
}): {
  data: MobileMemoryCapture[];
  fetching: boolean;
  nextCursor?: string;
  fetchMore: () => void;
  refetch: () => void;
};

// use-delete-mobile-memory-capture.ts
function useDeleteMobileMemoryCapture(): (input: {
  agentId: string;
  captureId: string;
}) => Promise<void>;
```

All three export from `packages/react-native-sdk/src/index.ts`. Ride the `0.3.0-beta.0` version bump that the sibling UI PRD already claims.

---

## 7. Mobile UI

### 7.1 Offline queue primitive

New: `apps/mobile/lib/offline/capture-queue.ts`

- **Storage:** AsyncStorage key `thinkwork:capture-queue:v1`, array of `QueuedCapture`.
- **Enqueue:** called synchronously on submit, returns the `clientCaptureId` for immediate optimistic rendering.
- **Flush:** subscribes to `@react-native-community/netinfo` `isConnected` events; also runs on app foreground. Fires captures in FIFO order.
- **Backoff:** per-entry `attemptCount` with delays `[2s, 8s, 30s, 2m, 10m, 1h]`. After 10 attempts, entry is marked `failed_permanent` and surfaces a persistent banner.
- **Agent binding:** `agentId` is set at enqueue and never rewritten. If the user switches agent, queued entries continue to target their original agent.

### 7.2 Components

All under `apps/mobile/components/memory/`:

- **`CaptureFooter.tsx`** — the composer. Layout:
  ```
  [FactTypeChip — only rendered when factType ≠ FACT]
  [ TextInput (multi-line, max 6 lines, iOS dictation) ]
  [ + | counter | mic | ↑ ]
  ```
  - `+` opens `FactTypePicker`.
  - Mic focuses input and triggers iOS system dictation (native RN `TextInput` supports it with `autoCapitalize='sentences'` + `dictationTypes`; no additional plugin needed). Sets `metadata.captured_via = 'dictation'` when the user activated the mic before sending.
  - Counter: neutral to 1,499 → amber at 1,500 → red and send-disabled at 2,000.
  - Send button calls `onSubmit(content, factType, metadata)` passed in from parent.

- **`FactTypeChip.tsx`** — compact pill showing the selected type with a small close button to revert to FACT. Reuses `components/ui/badge.tsx` styles with distinct tokens per type (Fact=sky, Preference=amber, Experience=teal, Observation=violet).

- **`FactTypePicker.tsx`** — bottom sheet using `components/ui/action-sheet.tsx`. 4 rows with icon + title + one-line explanation. Tapping selects the type and dismisses.

- **`CaptureRow.tsx`** — capture list row. Layout:
  ```
  [ fact-type dot/chip | content preview (2 lines) | time | status icon ]
  ```
  - Status icons: spinner (saving), none (saved), cloud-off (sync_pending), red retry (failed — tap retries).
  - Swipe-left reveals delete action. Confirmed delete calls `useDeleteMobileMemoryCapture` when the row is synced, or removes from the queue when local-only.

- **`CapturesList.tsx`** — FlatList merging server-side `useMobileMemoryCaptures` with local offline-queue entries. Local entries with a matching `clientCaptureId` supersede the server version until sync reconciles.

### 7.3 Wiring

Modify `apps/mobile/app/(tabs)/index.tsx`:
- Memories branch renders `CapturesList` whenever the Memories tab is active and filter ∈ `{ All, Captures }` (the Captures segment lives on the `MemoryFilterBar` defined in the sibling UI PRD).
- `CaptureFooter` pinned at the bottom of the Memories branch (replacing the current placeholder `MessageInputFooter`).
- `onSubmit` flow:
  1. Generate `clientCaptureId` (uuid v4).
  2. Push optimistic row to list state with `status: 'saving'` and current `agentId`.
  3. Enqueue to `capture-queue`.
  4. Attempt immediate flush via `useCaptureMobileMemory`.
  5. On 2xx: row flips to `saved`, show toast "Saved to Marco's memory · Undo" for 5s.
  6. On network error: row flips to `sync_pending`; queue handles retry.
  7. On 4xx: row flips to `failed`; toast "Couldn't save — tap to retry."
  8. Agent switch: draft text transfers to the new agent's composer; queued/optimistic rows retain original `agentId`.

### 7.4 Toast

Reuse or extend `apps/mobile/components/ui/toast.tsx`. API:
```ts
showToast({
  message: `Saved to ${activeAgent.name}'s memory`,
  actionLabel: 'Undo',
  onAction: () => deleteCapture({ agentId, captureId }),
  durationMs: 5000,
});
```
Visual: 5s countdown progress bar runs under the text so the user sees the undo window.

### 7.5 Reused primitives

- `components/ui/action-sheet.tsx` — picker bottom sheet
- `components/ui/badge.tsx` — TypeChip + row fact-type dots
- `lib/hooks/use-agents.ts` — active agent resolution
- `@react-native-community/netinfo` — connectivity events (already a mobile dep)
- `@react-native-async-storage/async-storage` — offline queue persistence (already present)

---

## 8. Rollout — 3 PRs

Each PR ships from a worktree under `.claude/worktrees/` per project convention.

### PR A — End-to-end text capture (MVP)
- Adapter tweak (`fact_type_override`).
- `captureMobileMemory` mutation + resolver.
- `useCaptureMobileMemory` SDK hook.
- Minimal `CaptureFooter` (no picker, no chip, no counter colors, no offline queue).
- Typing + tapping send writes to Hindsight; confirmation via inline loading state.
- Acceptance: Hindsight dashboard shows the unit in Marco's bank with correct metadata.

### PR B — Captures list + undo + offline queue
- Captures filter segment added to `MemoryFilterBar`.
- `CapturesList`, `CaptureRow`, `mobileMemoryCaptures` query + resolver.
- `deleteMobileMemoryCapture` mutation + resolver + `useDeleteMobileMemoryCapture` hook.
- Offline queue (`capture-queue.ts`) + status state machine.
- Toast-with-Undo component.
- Acceptance: the full lifecycle from §11 manual tests passes.

### PR C — Picker + metadata polish + dictation
- `FactTypePicker` + `FactTypeChip`.
- Full metadata stamping (`client_platform`, `app_version`, `captured_via`).
- iOS dictation props on the TextInput; mark `captured_via: 'dictation'` when the mic was used.
- Char counter thresholds + color shifts + send-disable at cap.
- Acceptance: every entry in §11 passes.

---

## 9. Non-functional requirements

### Performance
- Tap send → optimistic row appears: <16ms (one frame).
- Online sync latency target: p95 ≤ 800ms end-to-end to Hindsight.
- Queue flush latency on reconnect: ≤ 3s for a 10-entry backlog.

### Reliability
- Writes are idempotent on `clientCaptureId`. Retries after network blips cannot create duplicates.
- Queue survives app kill and device restart (AsyncStorage-backed).

### Accessibility
- All controls have `accessibilityLabel`: "Add memory", "Choose memory type", "Dictate", "Send memory".
- VoiceOver announces toast content and Undo action.
- Swipe-delete alternative: long-press to open actions sheet with Delete.

### Privacy
- Capture text is stored in Hindsight bound to the tenant; existing tenant scoping applies.
- Metadata does not include location or device fingerprint beyond `client_platform` + `app_version`.

---

## 10. Open questions

Flag if they become blockers; otherwise use the default noted.

1. **Capture retention when the user deletes the source agent.** If an admin deletes Marco, do Marco's captured units cascade-delete? Default: follow existing agent-deletion policy (which already governs chat-derived memory).
2. **Team-wide captures.** Out of scope for v1; future "broadcast to team" affordance tracked as a v1.1 follow-up.
3. **Compile pipeline hook.** The compile pass should treat `capture_source: 'mobile_quick_capture'` as a high-signal source. Separate PRD/ticket owned by the compile team.
4. **Capture-to-page promotion preview.** When compile later promotes a capture into a wiki page, should the Captures segment indicate "→ became Entity: Kira"? Defer to a follow-up PR; not required for v1.
5. **Android parity.** v1 ships iOS; Android follows. iOS dictation path must be reviewed for Android equivalents (Google Keyboard voice input) when Android lands.

---

## 11. Verification

### Unit / integration
- Offline queue: enqueue persists to AsyncStorage; flush dequeues in FIFO order; `agentId` is preserved across agent-switch; backoff delays match spec.
- Resolver idempotency: two calls with the same `clientCaptureId` return the same `MobileMemoryCapture.id`.
- `deleteMobileMemoryCapture` rejects units whose metadata lacks `capture_source` (scope check).
- Adapter: `fact_type_override` honored when present and legal; ignored when illegal (e.g. random string).

### Manual
1. Type "Kira leads the infra team" with Marco selected → tap send → row appears immediately with `saving` → flips to `saved` within 500ms → toast with Undo shows for 5s.
2. Tap Undo within the 5s window → row disappears; Hindsight unit is deleted.
3. Airplane mode → type "async standups on Tuesdays" → tap send → row shows `sync_pending`. Reconnect WiFi → within 30s row flips to `saved` and syncs to Marco's bank.
4. Switch agent Marco → Tara mid-draft → draft text remains in the composer; any in-flight `saving` or queued rows stay bound to Marco's bank (verify via Hindsight dashboard).
5. Pick **Preference** from the `+` picker → chip appears above input → type "prefers dark mode" → send → verify the Hindsight unit's `metadata.fact_type` is `opinion`.
6. Paste 3,000 chars → counter is red, send disabled; trim to 1,800 → counter is amber, send enabled.
7. Swipe-left on a Captures row → Delete → confirm → row removed, Hindsight unit deleted.
8. Tap mic → iOS dictation overlay activates inside the text field → speak → transcription appears → send → verify `metadata.captured_via === 'dictation'`.

### End-to-end behavioral
- After capturing "Kira leads the infra team" on Marco, open a new thread with Marco and ask "who runs the infra team?" → Marco's response cites Kira, confirming read-side integrity.
- The capture appears in Captures filter segment within 1s of save.
- Switching to Tara → Captures segment is empty for Tara (agent-scope isolation).

### Success metrics
- Captures submitted per active mobile user per week.
- Recall hit rate: % of agent turns where a mobile-captured unit appears in recall results.
- Undo usage rate: % of captures undone within the 5s window (high rate → reconsider friction or type-picker placement).
- Offline sync success rate: % of queued captures that successfully sync within 60s of reconnect.

---

## 12. Summary for the coding agent

Build a footer composer on the Memories tab that writes directly into the active agent's Hindsight bank. One bank per agent means the agent binding is structural — write to `Marco's bank`, and Marco's recall finds it automatically. Default fact_type is **world** via `explicit_remember`; the `+` button opens a picker that lets users override to Preference, Experience, or Observation. Captures surface in a new **Captures** filter segment on the Memories tab with optimistic rendering, an Undo toast, and swipe-delete. Offline is handled via an AsyncStorage-backed queue that binds to the capture-time agent. Ship in 3 PRs: end-to-end text capture → list + undo + offline queue → picker + metadata polish + dictation. Do not build editing, multimodal captures, cross-agent broadcasts, or compile-promotion previews in v1. Escalate scope ambiguity to Eric.
