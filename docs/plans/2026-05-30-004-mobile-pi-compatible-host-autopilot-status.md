# Mobile Pi Compatible Host Autopilot Status

## 2026-05-30 Closeout Audit

- Plan: `docs/plans/2026-05-30-004-feat-mobile-pi-compatible-host-plan.md`
- Status: active until deployed-stage all-capability smokes and TestFlight/on-device validation are recorded.
- Target branch: `main`
- Closeout branch: `codex/mobile-pi-host-closeout-status`
- Closeout PR: <https://github.com/thinkwork-ai/thinkwork/pull/1884>

### Merged Implementation Units

- U1 contract tests: PR <https://github.com/thinkwork-ai/thinkwork/pull/1871>, merge `a2c6badd388387fb41374e24f4c6e7103057b485`.
- U2 shared extension adapter: PR <https://github.com/thinkwork-ai/thinkwork/pull/1872>, merge `5e647638074d4ea44760d2fcf94f0de7f40e0af8`.
- U3 shared system prompt/workspace context: PR <https://github.com/thinkwork-ai/thinkwork/pull/1873>, merge `7b85b8c2ae031e17456b0b5467fbe7053cd6f044`.
- U4 rendered workspace cache and read/grep/find/ls: PR <https://github.com/thinkwork-ai/thinkwork/pull/1874>, merge `7e8768eccf5309470160506f74b460761156b257`.
- U5 workspace-backed local bash: PR <https://github.com/thinkwork-ai/thinkwork/pull/1875>, merge `c921aab417a47652493f88e5f8cfa7a92741274a`.
- U6 bounded MCP proxy: PR <https://github.com/thinkwork-ai/thinkwork/pull/1876>, merge `51fe2a01c154996944dcc0b1894ca86977e14b34`.
- U7 session lifecycle, durability, follow-up, abort, compaction: PR <https://github.com/thinkwork-ai/thinkwork/pull/1877>, merge `b594a49f4e9a28e75fa5a99d4c9bbcc0878f5943`.
- U8 mobile-native extensions: PR <https://github.com/thinkwork-ai/thinkwork/pull/1878>, merge `b20e7b38e5aee154fc13610e502091db8ec22b24`.
- U9 E2E smoke harness matrix: PR <https://github.com/thinkwork-ai/thinkwork/pull/1879>, merge `8e18a31e20a58f8b0cf58127577fc007936f4078`.
- U10 host-contained `just-bash` parity and mobile multiplayer follow-ups: PR <https://github.com/thinkwork-ai/thinkwork/pull/1880>, merge `7d1d3d7ac3503202c3fe5b3c50159c264560b6a6`.
- Mention picker anchoring follow-up: PR <https://github.com/thinkwork-ai/thinkwork/pull/1883>, merge `4f74efad75699f6bb3e17eaf9e8b3d9643d469cd`.

### Closeout Findings

- The closeout audit found a real harness gap after U10: `pnpm --filter @thinkwork/mobile smoke:pi-harness:dry-run` failed under `tsx` because the mobile `local-bash-extension` imported `just-bash/browser`, whose package subpath has no CommonJS `require` export.
- The fix is to import `just-bash` from the package root for Node/test/harness execution while forcing Metro to resolve both `just-bash` and `just-bash/browser` to the browser bundle for mobile/web bundling.

### Current Verification

- `pnpm --filter @thinkwork/mobile test -- lib/agent/compat/pi-contract.test.ts lib/agent/session.test.ts lib/agent/loop.test.ts lib/agent/extensions/__tests__/workspace-context-extension.test.ts lib/agent/turn-context.test.ts lib/agent/workspace-cache.test.ts lib/agent/tools lib/agent/extensions/__tests__/local-bash-extension.test.ts lib/agent/extensions/__tests__/mcp-tools-extension.test.ts lib/agent/thread-turn.test.ts lib/agent/persist-turn.test.ts lib/agent/capture-image.test.ts lib/agent/extensions/mobile-native` - passed, 88 tests.
- `pnpm --filter @thinkwork/pi-extensions test -- system-prompt` - passed, 6 tests.
- `pnpm --filter @thinkwork/api test -- src/handlers/mcp-proxy.test.ts` - passed, 16 tests.
- `pnpm --filter @thinkwork/mobile smoke:pi-harness:dry-run` - passed after the closeout fix, all ten smoke capabilities enumerated with thread id and identifier fields.
- `pnpm --filter @thinkwork/mobile test -- lib/agent/extensions/__tests__/local-bash-extension.test.ts` - passed, 9 tests.
- `pnpm --filter @thinkwork/mobile test` - passed, 182 tests.
- `pnpm --filter @thinkwork/react-native-sdk build` - passed.
- `pnpm --filter @thinkwork/mobile build:web` - passed.
- `pnpm --filter @thinkwork/desktop test -- test/sidecar/local-turn-runner.test.ts` - passed, 15 tests.
- `pnpm --filter @thinkwork/desktop typecheck` - passed.
- PR #1884 CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed before final doc-status update.

### Remaining Gates

- Deployed-stage harness run:
  `pnpm --filter @thinkwork/mobile smoke:pi-harness -- --capabilities all --json`.
  This needs `tenantId`, `agentId`, `userId`, and a current Cognito ID token; the checked-in/copyable `.env` files provide endpoints and API keys but not identity tokens.
- iOS TestFlight/on-device matrix from `apps/mobile/scripts/pi-device-smoke.md`, including image/file attachment and abort validation on a real device.
