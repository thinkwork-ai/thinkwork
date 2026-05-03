# @thinkwork/flue-aws

AWS-side connectors for Flue. **Spike-only as of 2026-05-03.**

This package exists to host the AgentCore Code Interpreter `SandboxFactory` produced by the FR-9a integration spike. It is structured per origin FR-8 to allow eventual extraction and upstream contribution to Flue: dependencies are limited to `@flue/sdk` (vendored as type stubs in `src/flue-types.ts` until Flue is published to npm) and `@aws-sdk/*`. Zero ThinkWork-monorepo imports.

## Status

- **Verdict:** see `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md`
- **Production readiness:** none. Tenant scoping, OTel instrumentation, error handling beyond surface-level, and tests beyond a happy-path smoke are all out of scope at this tier.
- **Upstream contribution path:** if the verdict is green, this package is the seed for `@flue/aws` (or similar) as a first-party Flue connector — see brainstorm `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md` FR-8.

## Why are Flue types vendored?

`@flue/sdk` is not yet published to npm. To keep this package self-checking without requiring a local Flue clone install, the minimal `SandboxApi` / `SessionEnv` / `FileStat` / `ShellResult` types we use are vendored at `src/flue-types.ts` with attribution. When `@flue/sdk` lands on npm, the stubs go away and the imports become real. The runtime adapter copy that lives in the Flue clone (for spike execution) imports from `@flue/sdk/sandbox` directly.

## Structure

```
packages/flue-aws/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   └── flue-types.ts                          # vendored Flue type stubs (temporary)
└── connectors/
    └── agentcore-codeinterpreter.ts           # SandboxFactory wrapping InvokeCodeInterpreterCommand
```
