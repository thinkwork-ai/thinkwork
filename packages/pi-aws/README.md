# @thinkwork/pi-aws

AWS-side connector helpers used by the Pi AgentCore runtime.

This package currently hosts the AgentCore Code Interpreter `SandboxFactory`
adapter that was originally proven during the Flue spike. The runtime is now
Pi-owned, but the sandbox interface remains a small local type surface under
`src/sandbox-types.ts` until the surrounding runtime abstraction is simplified.

## Structure

```
packages/pi-aws/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   └── sandbox-types.ts
└── connectors/
    └── agentcore-codeinterpreter.ts
```
