# Autopilot Status: Generic Admin Extension Host

Date: 2026-05-14
Repository: thinkwork-ai/thinkwork
Target branch: main
Autopilot branch: codex/u9-extension-host

## Current Unit

Unit: Generic Admin extension host and signed proxy
Status: Local verification passed; preparing PR

## Progress

- Created a generic build-time Admin extension registry with route mounting under `/extensions/:extensionId`.
- Added sidebar registration for enabled extensions without bundling any private extension implementation in the OSS app.
- Added a tenant-scoped extension proxy Lambda that allowlists backend URLs, requires owner/admin tenant membership, signs actor context, and strips browser credentials before forwarding.
- Wired the proxy handler into Lambda builds and the API Gateway module.
- Added focused tests for the Admin registry and API proxy authorization/forwarding behavior.
- Enabled GitHub auto-merge for this repository and updated the `main` ruleset so merges require the existing PR checks: `lint`, `typecheck`, `test`, `verify`, and `cla`.

## Local Verification

- `pnpm --filter @thinkwork/admin test -- src/extensions/__tests__/registry.test.ts` - passed
- `pnpm --filter @thinkwork/api test -- src/__tests__/extension-proxy.test.ts` - passed
- `pnpm --filter @thinkwork/admin build` - passed
- `pnpm --filter @thinkwork/api typecheck` - passed

## Next Steps

- Open a PR, wait for required CI checks, squash merge, delete the branch, and sync `main`.

## Final Local Verification

- `terraform fmt terraform/modules/app/lambda-api/handlers.tf terraform/modules/app/lambda-api/outputs.tf terraform/modules/app/lambda-api/variables.tf` - passed
- `pnpm dlx prettier@3.8.2 --check <touched TS/TSX/MD files>` - passed
- `git diff --check` - passed
- `bash scripts/build-lambdas.sh extension-proxy` - passed
- `pnpm --filter @thinkwork/admin build` - passed
- `pnpm --filter @thinkwork/admin test -- src/extensions/__tests__/registry.test.ts` - passed
- `pnpm --filter @thinkwork/api test -- src/__tests__/extension-proxy.test.ts` - passed
- `pnpm typecheck` - passed
- `pnpm lint` - passed
- `pnpm lint:agentcore-iam` - passed
- `pnpm test` - passed
- `bash scripts/verify-supply-chain.sh` - passed

`pnpm format:check` now executes when Prettier is available, but it reports a pre-existing repo-wide backlog across many untouched files. The touched files in this unit were checked with Prettier directly to avoid unrelated formatting churn.
