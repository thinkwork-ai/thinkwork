# Mobile Pi Compatible Host Autopilot Status

## 2026-05-30 U10 / Mobile Parity Follow-Ups

- Branch: `codex/mobile-pi-host-u10-just-bash`
- PR: <https://github.com/thinkwork-ai/thinkwork/pull/1880>
- Status: implemented locally; awaiting final push/CI/merge.

### Implemented

- Standardized Desktop Local Pi bash on a host-provided `just-bash` tool instead of native SDK shell access.
- Kept Mobile Pi bash on `just-bash/browser` so Hermes uses the mobile-safe package entrypoint.
- Updated shared Pi prompt language to describe bash as a host-contained workspace sandbox.
- Added mobile thread participant identity rendering for multiplayer rows, including initials for other human participants.
- Defaulted mobile multiplayer threads and drafts that mention another user to human-only sends unless the agent is explicitly toggled on or `@agent`/`@think` is used.
- Added mobile mention target loading for new-thread and existing-thread composers and persisted structured mentions through `sendMessage` for human-only sends.
- Matched requested composer polish: 2px top padding over the Space picker, no explicit `@` toolbar icon, elevated mention picker, and no member badge in mention rows.

### Local Verification

- `pnpm --filter @thinkwork/mobile test` - passed, 182 tests.
- `pnpm --filter @thinkwork/mobile build:web` - passed.
- `pnpm --filter @thinkwork/agentcore-pi test -- agent-container/tests/system-prompt.test.ts agent-container/tests/server.test.ts` - passed, 58 tests.
- `pnpm --filter @thinkwork/desktop test -- test/sidecar/local-turn-runner.test.ts` - passed, 15 tests.
- `pnpm --filter @thinkwork/desktop typecheck` - passed.
- `git diff --check` - passed.
- iOS Simulator visual checks:
  - Mobile just-bash smoke returned `MOBILE-JUST-BASH-SMOKE-OK`.
  - Multiplayer timeline shows other participant initials and current user as distinct.
  - Mention autocomplete appears from typed `@` text, without the removed footer icon or member badge.

### Remaining

- Push amended PR #1880.
- Wait for required CI checks.
- Fix any CI failures, then squash merge and delete the branch/worktree.
