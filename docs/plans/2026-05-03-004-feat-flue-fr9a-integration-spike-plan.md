---
title: feat: FR-9a integration spike — AgentCore CI SandboxFactory + Bedrock routing
type: feat
status: active
date: 2026-05-03
origin: docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
---

# feat: FR-9a integration spike — AgentCore CI SandboxFactory + Bedrock routing

## Summary

Build a `SandboxFactory` for AWS Bedrock AgentCore Code Interpreter that conforms to Flue's `SessionEnv` interface, smoke-test it against a real interpreter in the dev account, verify Bedrock model routing through Flue's `init({ providers })`, and capture a written verdict that gates plan revision for the 2026-04-26 Pi parallel plan + three follow-up plans. Spike is exploratory — favor evidence-gathering over feature-completeness, and exit cleanly with a partial verdict if any sub-question hits an environment block.

## Problem Frame

The 2026-05-03 brainstorm (origin) commits to depending on `@flue/sdk` upstream and integrating ThinkWork resources only through Flue's documented extension points. Plan revision is gated on FR-9a, an integration spike that resolves the brainstorm's largest unverified assumptions: AgentCore Code Interpreter compatibility with Flue's `BashLike`/`SessionEnv` shape, and Bedrock model routing through Flue's `providers` config (see origin: `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md`).

Existing AgentCore Code Interpreter access is confirmed: dev account `487219502366` has two READY interpreters (`thinkwork_dev_0015953e_int-5Wi3TRcVTJ`, `thinkwork_dev_0015953e_pub-5rETNEk2Vt`). Existing Pi container's `packages/agentcore-pi/agent-container/src/runtime/tools/execute-code.ts` invokes `InvokeCodeInterpreterCommand` with `name: "executeCode"` and `language: "python"` only — the spike must explore the broader API surface (`executeCommand`, `readFiles`, `writeFiles`, `listFiles`, `removeFiles`) to map onto Flue's `SessionEnv` operations.

---

## Requirements

- R1. Produce a working `SandboxFactory` (or a `BashFactory`-shaped equivalent — chosen at U2 based on which Flue interface fits AgentCore CI's surface more cleanly) that wraps AgentCore Code Interpreter and runs at least one round-trip command end-to-end against the dev account. (Origin: FR-5, FR-9a primary.)
- R2. Produce a capability matrix mapping `SessionEnv` operations (`exec`, `readFile`, `writeFile`, `readdir`, `mkdir`, `rm`, `stat`, `exists`) onto AgentCore CI's `InvokeCodeInterpreterCommand` tools (`executeCommand`, `executeCode`, `readFiles`, `writeFiles`, `listFiles`, `removeFiles`) — supported / wrapped-in-Python / unsupported. (Origin: FR-5, FR-9a primary.)
- R3. Verify that Flue's `init({ model, providers })` API can route inference to Bedrock — either via `providers.anthropic.baseUrl` override pointing at a Bedrock-Anthropic-compatible endpoint, a `bedrock/` provider prefix (if Flue supports one), or `pi-ai`'s `getModel('amazon-bedrock', ...)` reachable through Flue's session — OR name the gap precisely. (Origin: FR-9a secondary.)
- R4. Capture AgentCore CI's tenant-isolation guarantee — locate authoritative AWS documentation OR run a behavioral test that creates two sessions and checks for filesystem / process / env state leakage. (Origin: FR-9a tertiary.)
- R5. Write a verdict document at `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md` containing the capability matrix, Bedrock routing pass/fail, tenant-isolation finding, and one of the five outcome labels: green / AgentCore-CI-gap-tolerable-with-Python-wrap / AgentCore-CI-gap-requires-base-image-rebuild / Bedrock-routing-blocked / Daytona-as-practical-default. (Origin: FR-AE5.)
- R6. The spike's connector code lives at `packages/flue-aws/connectors/agentcore-codeinterpreter.ts` (and supporting types under the same package), with `package.json` declaring deps only on `@flue/sdk`, `@aws-sdk/client-bedrock-agentcore`, and any required type-only support — zero ThinkWork-monorepo imports per origin FR-8.

**Origin actors:** A4 (Platform engineer — runs the spike).
**Origin flows:** F4 (Two-spike validation precedes plan revision).
**Origin acceptance examples:** AE5 (FR-9a verdict artifact).

---

## Scope Boundaries

- **Productionizing the connector** — out. Spike output is evidence + verdict, not a hardened tenant-scoped runtime. Productionization happens during plan revision after a green verdict.
- **Multi-tenant context propagation through MCP / per-user OAuth** — out (deferred to plan revision; FR-3a / FR-4a in origin handle this).
- **Aurora-backed `SessionStore` adapter** — out (deferred to plan revision; origin OQ).
- **Python skill subprocess bridge** — out (deferred; origin FR-7).
- **Wiring into the deployed AgentCore runtime container** — out. Spike runs locally against the Flue dev-mode CLI invoking the AWS API directly.
- **Editing `packages/agentcore-pi/`** — out. The spike package is new (`packages/flue-aws/`); it does not touch the in-flight Pi vendoring track.
- **Deciding wrap-in-Python vs base-image-rebuild** — out at this tier. The spike *captures* the gap; the brainstorm's Next Steps step 4 handles the decision based on the verdict.

### Deferred to Follow-Up Work

- **Productionized AgentCore CI connector with tenant scoping, OTel instrumentation, and tests** — landed during /ce-plan revision after the verdict.
- **Aurora `SessionStore` adapter prototype** — origin OQ; separate plan-time work.
- **Bedrock provider override upstream contribution to Flue** — only if R3 reveals a missing capability the Flue team would accept.

---

## Context & Research

### Relevant Code and Patterns

- `packages/agentcore-pi/agent-container/src/runtime/tools/execute-code.ts` (218 LOC) — existing AgentCore CI client. Uses `InvokeCodeInterpreterCommand` with `name: "executeCode"`, hard-rejects `language !== "python"`. Spike's connector covers the broader tool name set but does not modify this file.
- `/Users/ericodom/Projects/flue/examples/hello-world/.flue/connectors/daytona.ts` (5 KB) — canonical Flue connector pattern. Implements `SandboxApi` (file ops via `sandbox.fs.*`) and exposes a `daytona(sandbox)` factory that calls `createSandboxSessionEnv()` from `@flue/sdk/sandbox`. Spike's connector mirrors this shape for AgentCore CI. *(External path; spike copies the relevant pattern into the new package.)*
- `/Users/ericodom/Projects/flue/packages/sdk/dist/types-*.d.mts` — Flue's `SessionEnv`, `SandboxApi`, `SandboxFactory`, `BashLike`, `BashFactory` interface definitions. `SessionEnv` is the target shape; `SandboxApi` is what `createSandboxSessionEnv` wraps.
- `terraform/modules/app/agentcore-code-interpreter/main.tf` — provisions the dev-account interpreters. Spike does not modify this; it consumes the existing IDs.

### Institutional Learnings

- *(none directly applicable to AgentCore CI capability surface — this is the first ThinkWork spike against the broader API; the existing `execute-code.ts` covered only the Python execution subset.)*
- `feedback_communication_style` — terse, lead with recommendation, blow-by-blow on request only. Verdict doc follows the FR-9 verdict's tight structure.
- `feedback_avoid_fire_and_forget_lambda_invokes` — the spike's AWS calls are synchronous and surface errors; no fire-and-forget patterns.

### External References

- AWS Bedrock AgentCore Code Interpreter API — `InvokeCodeInterpreterCommand` supports `name: executeCode | executeCommand | readFiles | writeFiles | listFiles | removeFiles` (per AWS SDK types in `@aws-sdk/client-bedrock-agentcore`).
- Flue connectors README at `/Users/ericodom/Projects/flue/connectors/README.md` — pattern for new sandbox connectors; AgentCore CI connector is a candidate for upstream contribution under the existing `sandbox` category (origin assumption).

---

## Key Technical Decisions

- **Spike package lives at `packages/flue-aws/`** with a minimal `package.json` declaring only `@flue/sdk` and `@aws-sdk/client-bedrock-agentcore` as runtime deps. Mirrors origin FR-8 separability commitment. Even at spike tier, the zero-monorepo-imports posture is enforced so the verdict's R6 finding is auditable.
- **Use `SandboxFactory` (not `BashFactory`)** as the Flue integration shape. `SandboxFactory.createSessionEnv` returns a `SessionEnv` directly via `createSandboxSessionEnv` from `@flue/sdk/sandbox`, matching the Daytona pattern. `BashFactory` would require us to expose `BashLike` semantics (an in-memory FS plus `exec`), which AgentCore CI's API does not naturally provide — `SandboxApi` is the better fit because its file methods map onto `readFiles`/`writeFiles`/`listFiles` directly.
- **Use the `_pub` interpreter** (`thinkwork_dev_0015953e_pub-5rETNEk2Vt`) for spike invocations. The `_pub` interpreter is the tenant-facing one; using it surfaces any tenant-scoping concerns the verdict needs to address.
- **Single AWS region — `us-east-1`** for all spike calls. Matches existing dev infrastructure region per `project_dev_db_secret_pattern`.
- **Two test agents** — one for AgentCore CI (`agentcore-ci-spike.ts`), one for Bedrock routing (`bedrock-routing-spike.ts`). Each agent is the smallest possible that exercises its target question. Keeping them separate makes the verdict's per-axis findings cleaner.
- **Spike is single-PR scope.** All units land in one commit chain. No multi-PR rollout, no inert-then-live seam — the spike either works or surfaces the gap.
- **Cleanly cancellable.** If U3 hits an unrecoverable AWS error (e.g., session creation fails, permissions issue not resolvable in the spike's time budget), exit at U5 with a partial verdict naming the gap. Do not block on AWS provisioning that would expand spike scope.

---

## Open Questions

### Resolved During Planning

- *Connector package location:* `packages/flue-aws/` (resolved per Key Decision above).
- *Which interpreter to use:* `_pub` (resolved per Key Decision above).
- *AWS access available:* Yes — verified via `aws sts get-caller-identity` and `aws bedrock-agentcore-control list-code-interpreters --region us-east-1`.
- *Connector shape:* `SandboxFactory` (resolved per Key Decision above).

### Deferred to Implementation

- *Exact `SessionEnv.exec` mapping:* Whether `executeCommand` accepts the same shell-string format Flue's `BashLike.exec` expects, or requires structured args (cwd, env, timeout). Discovered at U2 by reading `@aws-sdk/client-bedrock-agentcore` types. If structured-only, the connector wraps Flue's command string in a shell-launching `executeCommand` invocation; the verdict notes the wrap.
- *Tenant-isolation behavioral test design:* If AWS docs don't yield a clear citation in U4, the behavioral test creates two `_pub` sessions, writes a sentinel file in each, and checks neither session sees the other's file. Exact session-creation API discovered at U4.
- *Bedrock routing path:* Three candidates — `providers.anthropic.baseUrl` override, a `bedrock/` provider prefix, or `pi-ai`'s `getModel('amazon-bedrock', ...)` reachable through `init({ model: <ModelDef> })`. U5 picks one based on what Flue's `init()` accepts.
- *Capability matrix granularity:* How fine-grained the matrix needs to be (e.g., do we test `mkdir -p` vs `mkdir`, or just `mkdir`). Aim for one row per `SessionEnv` method, sub-bullets only when the AgentCore CI mapping is non-trivial.

---

## Output Structure

```
packages/flue-aws/
├── package.json                              # deps: @flue/sdk, @aws-sdk/client-bedrock-agentcore
├── tsconfig.json
├── README.md                                  # one-paragraph: what this package is, spike-only status
└── connectors/
    └── agentcore-codeinterpreter.ts           # SandboxFactory wrapping InvokeCodeInterpreterCommand

docs/solutions/architecture-patterns/
└── flue-fr9a-integration-spike-verdict-2026-05-03.md   # the verdict doc (R5)
```

The connector code is also copied to (not symlinked, to keep clones independent) `/Users/ericodom/Projects/flue/examples/hello-world/.flue/connectors/agentcore-codeinterpreter.ts` plus the spike test agents at `.flue/agents/agentcore-ci-spike.ts` and `.flue/agents/bedrock-routing-spike.ts` — these are external to the ThinkWork repo and live only in Eric's local Flue clone for the spike run.

---

## Implementation Units

- U1. **Scaffold `packages/flue-aws/` package**

**Goal:** Create a new monorepo package with the minimum scaffolding to host the spike connector. Zero ThinkWork-monorepo imports per origin FR-8.

**Requirements:** R6.

**Dependencies:** None.

**Files:**
- Create: `packages/flue-aws/package.json`
- Create: `packages/flue-aws/tsconfig.json`
- Create: `packages/flue-aws/README.md`

**Approach:**
- `package.json` name: `@thinkwork/flue-aws`. Private. Type module. Deps: `@flue/sdk` (latest matching the local Flue clone version, currently 0.3.10), `@aws-sdk/client-bedrock-agentcore` (matching `packages/agentcore-pi/package.json`'s pin, ^3.1028.0). Dev deps: `typescript`, `@types/node`. Scripts: `build`, `typecheck`, `test` (no-op for spike).
- `tsconfig.json` extends repo root `tsconfig.base.json`; emits ES modules; `module: ESNext`, `moduleResolution: bundler`.
- `README.md` ~5 lines: package name, "spike-only — see `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md`", upstream-contribution intent per origin FR-8.

**Patterns to follow:**
- `packages/agentcore-pi/package.json` for AWS SDK pinning + module type.
- `packages/agentcore-pi/tsconfig.json` for compiler options.

**Test scenarios:**
- Test expectation: none — pure scaffolding, no behavior.

**Verification:**
- `pnpm install` succeeds at the repo root with the new package present.
- `pnpm --filter @thinkwork/flue-aws typecheck` passes against the scaffolded (empty) source tree.

---

- U2. **Implement `agentcoreCodeInterpreter` connector**

**Goal:** Implement a `SandboxFactory` wrapping `InvokeCodeInterpreterCommand` that exposes Flue's `SessionEnv` operations (`exec`, `readFile`, `writeFile`, `readdir`, `mkdir`, `rm`, `stat`, `exists`).

**Requirements:** R1, R2, R6.

**Dependencies:** U1.

**Files:**
- Create: `packages/flue-aws/connectors/agentcore-codeinterpreter.ts`
- Test: `packages/flue-aws/connectors/agentcore-codeinterpreter.test.ts` (smoke unit test against mocked AWS client; real-AWS smoke is U3)

**Approach:**
- Export `agentcoreCodeInterpreter(client, options)` factory returning `SandboxFactory`. `client` is a `BedrockAgentCoreClient` instance the caller constructs (mirrors the Daytona pattern of "user owns the SDK relationship").
- Internal `AgentCoreCodeInterpreterApi implements SandboxApi`:
  - `exec(command, options)` → `InvokeCodeInterpreterCommand` with `name: "executeCommand"`, `arguments: { command }`. If `executeCommand` accepts cwd/env/timeout, plumb through; if not, the connector's first iteration documents the gap in the capability matrix and wraps in a shell prefix (`cd <cwd> && <env exports> && <command>`).
  - `readFile(path)` → `name: "readFiles", arguments: { paths: [path] }`. Decode response; return string.
  - `readFileBuffer(path)` → same, but return as `Uint8Array`.
  - `writeFile(path, content)` → `name: "writeFiles", arguments: { content: [{ path, text: ... }] }`.
  - `readdir(path)` → `name: "listFiles", arguments: { directoryPath: path }`. Return string array.
  - `mkdir`, `rm`, `stat`, `exists` — implemented via `executeCommand` shell wrappers (`mkdir -p`, `rm -rf`, `test -e`, `stat`) since AgentCore CI doesn't expose direct primitives. Document in capability matrix as "wrapped via executeCommand".
- Factory function delegates to `createSandboxSessionEnv(api, { id, cwd })` from `@flue/sdk/sandbox`.
- Session lifecycle: a `_pub` AgentCore CI session is created lazily on first call, ID cached in the API instance, deleted on session destroy if `cleanup: true`. Mirrors Daytona's optional cleanup pattern.

**Technical design (directional, not implementation):**

```
agentcoreCodeInterpreter(client, { interpreterId, cleanup }) → SandboxFactory
  createSessionEnv({ id, cwd }) → SessionEnv
    api = new AgentCoreCodeInterpreterApi(client, interpreterId, sessionLazy)
    return createSandboxSessionEnv(api, { id, cwd })

AgentCoreCodeInterpreterApi (SandboxApi):
  exec       → InvokeCodeInterpreterCommand(name=executeCommand)
  readFile   → InvokeCodeInterpreterCommand(name=readFiles)
  writeFile  → InvokeCodeInterpreterCommand(name=writeFiles)
  readdir    → InvokeCodeInterpreterCommand(name=listFiles)
  mkdir/rm/stat/exists → exec("mkdir -p ..." etc)
```

**Patterns to follow:**
- `/Users/ericodom/Projects/flue/examples/hello-world/.flue/connectors/daytona.ts` — class shape, factory export, `createSandboxSessionEnv` usage, optional cleanup.
- `packages/agentcore-pi/agent-container/src/runtime/tools/execute-code.ts` lines 170-217 — `InvokeCodeInterpreterCommand` usage pattern with `consumeStream` on the response stream.

**Test scenarios:**
- Happy path: `exec("echo hello")` resolves to `{ stdout: "hello\n", exitCode: 0 }` (mocked AWS response). *Covers R1.*
- Happy path: `readFile("/tmp/test.txt")` returns the mocked content string. *Covers R2.*
- Happy path: `writeFile("/tmp/test.txt", "data")` calls `InvokeCodeInterpreterCommand` with `name: "writeFiles"` and the right shape. *Covers R2.*
- Edge case: `readFile` on a path that the mocked AWS client returns an error for surfaces the error to the caller (does not silently return empty string).
- Edge case: `readdir` on an empty directory returns `[]` (mocked).
- Integration: factory function returns an object whose `createSessionEnv()` produces a `SessionEnv` with `exec`, `readFile`, `writeFile`, `readdir` methods present. (Type-level check counts as a test.)

**Verification:**
- `pnpm --filter @thinkwork/flue-aws typecheck` passes.
- The test file runs via `vitest` and all scenarios green against mocked AWS.

---

- U3. **Smoke-test the connector against real AgentCore CI**

**Goal:** Run the connector against the dev account's `_pub` interpreter end-to-end. Capture which `SessionEnv` operations work cleanly, which require shell-wrapping, and which fail.

**Requirements:** R1, R2, R4.

**Dependencies:** U2.

**Files:**
- Create (external — Flue clone, not committed to ThinkWork): `/Users/ericodom/Projects/flue/examples/hello-world/.flue/connectors/agentcore-codeinterpreter.ts` (copy of U2's connector; the Flue example workspace is where the spike actually runs).
- Create (external): `/Users/ericodom/Projects/flue/examples/hello-world/.flue/agents/agentcore-ci-spike.ts` — a Flue agent that:
  - Constructs `BedrockAgentCoreClient` with `region: "us-east-1"`.
  - Calls `agentcoreCodeInterpreter(client, { interpreterId: "thinkwork_dev_0015953e_pub-5rETNEk2Vt" })` to get a `SandboxFactory`.
  - Inside the agent, runs through each `SessionEnv` operation (`exec("uname -a")`, `writeFile + readFile round-trip`, `readdir("/tmp")`, `mkdir + rm`, `stat`, `exists`) and records pass/fail/notes per operation.
  - Returns a structured result: `{ matrix: [{ op, status, notes }], allPassed: boolean }`.
- Capture: spike output dumped to `/tmp/fr9a-spike-output.json` (not committed) for U5 to read into the verdict doc.

**Approach:**
- Run via `cd /Users/ericodom/Projects/flue/examples/hello-world && node ../../packages/cli/dist/flue.js run agentcore-ci-spike --target node --id fr9a-1 --env .env`. The `.env` file already has the Anthropic key from the FR-9 spike; AWS credentials come from the host shell.
- Tenant-isolation behavioral test (R4): if time permits within the spike budget, run a second invocation with `--id fr9a-2`, write a sentinel file in each, confirm neither sees the other's file. Add to the matrix output. If documentation citation found first via U4 web check, use that and skip the behavioral test.
- If any AWS error blocks progress (auth, permissions, interpreter not READY), capture the error verbatim and proceed to U5 with a partial verdict naming the block.

**Patterns to follow:**
- `/Users/ericodom/Projects/flue/examples/hello-world/.flue/agents/with-sandbox.ts` — exact shape of "construct client, invoke factory, run a battery of SessionEnv calls" already used for the Daytona spike in FR-9.
- The FR-9 spike's existing `flue run` invocation pattern: works without modification.

**Test scenarios:**
- Happy path: `exec("uname -a")` returns Linux + non-zero stdout. *Covers R1.*
- Happy path: `writeFile("/tmp/sentinel.txt", "fr9a")` followed by `readFile("/tmp/sentinel.txt")` returns `"fr9a"`. *Covers R2.*
- Happy path: `readdir("/tmp")` returns array including `sentinel.txt` after the write.
- Edge case: `mkdir` + `rm` round-trip succeeds (or fails — capture which).
- Edge case: `stat`/`exists` on a non-existent path returns the right shape (or fails — capture).
- Integration: tenant isolation — two sessions with different `id`s do not see each other's filesystem. *Covers R4 if behavioral test path is taken.*

**Verification:**
- `flue run agentcore-ci-spike` exits 0 with a JSON result containing the operation matrix.
- At least one operation (`exec` minimum) returns a clean Linux response.
- Capture matrix in `/tmp/fr9a-spike-output.json` for U5.

---

- U4. **Verify Bedrock model routing through Flue**

**Goal:** Determine whether Flue's `init({ model, providers })` API can route inference to Bedrock. Pass/fail with the precise routing path identified, or a precise gap statement.

**Requirements:** R3.

**Dependencies:** U1 (so the workspace exists). Independent of U2/U3.

**Files:**
- Create (external — Flue clone): `/Users/ericodom/Projects/flue/examples/hello-world/.flue/agents/bedrock-routing-spike.ts` — a Flue agent that:
  - Attempts to construct an agent with `init({ model: "...", providers: { anthropic: { baseUrl: "..." } } })` pointing at a Bedrock-Anthropic-compatible endpoint (the AgentCore-Anthropic invoke URL or Bedrock direct).
  - On the first attempt, uses `providers.anthropic.baseUrl` override.
  - On second attempt (only if the first fails), tries a `bedrock/<model-id>` provider-prefix shape if Flue accepts it.
  - On third attempt (only if the first two fail), checks whether `init({ model: <ModelDef> })` accepts a pi-ai `getModel('amazon-bedrock', ...)` directly.
  - Records which path worked and a one-line note per attempted path.

**Approach:**
- Three attempts, ordered cheapest-to-most-invasive.
- Each attempt logs success/failure with the actual error message if it fails.
- Time budget: 30-60 minutes within U4. If all three paths fail, the verdict labels Bedrock-routing-blocked and the brainstorm Next Step #5 fires.
- Use `pi-ai`'s knowledge of the Bedrock provider URL (it has a built-in `amazon-bedrock` provider — see `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts:82-88`) to derive the right base URL if the override path is taken.

**Patterns to follow:**
- `/Users/ericodom/Projects/flue/examples/hello-world/.flue/agents/hello.ts` — minimal agent shape; the Bedrock spike agent is essentially `hello` with a different `model` + `providers` config.
- `packages/agentcore-pi/agent-container/src/runtime/pi-loop.ts:82-88` — how the existing Pi container constructs the Bedrock model.

**Test scenarios:**
- Happy path: agent invoked with the Bedrock-routed config returns a response from Claude (any non-empty response counts). *Covers R3.*
- Edge case: each attempt's failure message is captured verbatim — the verdict doc carries the exact error text so a reader can verify the gap.
- Integration: if path #1 (`providers.anthropic.baseUrl`) succeeds, no further attempts run; the verdict notes which path worked first.

**Verification:**
- One of the three attempts returns a valid response, OR all three fail with captured errors.
- Result captured in `/tmp/fr9a-bedrock-output.json` for U5.

---

- U5. **Write FR-9a verdict + capability matrix**

**Goal:** Synthesize U2-U4's findings into the verdict document at `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md`. Document is the durable artifact that gates plan revision.

**Requirements:** R5, R2, R3, R4.

**Dependencies:** U2, U3, U4.

**Files:**
- Create: `docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md`

**Approach:**
- Match the structure of the FR-9 verdict at `docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md`: frontmatter (title, date, category, applies_when, related, tags), bold one-line verdict, "What was tested" section, "Findings" section, "Capability matrix" subsection (markdown table), "Bedrock routing" subsection, "Tenant isolation" subsection, "Gotchas", "Recommendation".
- Verdict label is one of: green / AgentCore-CI-gap-tolerable-with-Python-wrap / AgentCore-CI-gap-requires-base-image-rebuild / Bedrock-routing-blocked / Daytona-as-practical-default.
- Capability matrix table columns: `SessionEnv operation | AgentCore CI tool used | Status | Notes`. Status: `clean` (direct API) / `wrapped` (shell-wrapped via `executeCommand`) / `unsupported` / `failed`.
- Recommendation section ends with one of three branches matching the brainstorm's Next Steps #3/#4/#5: green → proceed to /ce-plan revision; gap → name which decision (a/b/c) the team should make; blocked → keep the 2026-04-26 vendoring track unmodified.
- Length budget: ~600 words (vs FR-9 verdict's ~500), allowing space for the capability matrix table.

**Patterns to follow:**
- `docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md` — frontmatter shape, prose discipline, recommendation framing.
- `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md` — long-form verdict with concrete error capture (precedent for including verbatim AWS errors in the doc).

**Test scenarios:**
- Test expectation: none — pure documentation, behavior verified by readability and frontmatter validity.

**Verification:**
- File exists at the named path with valid frontmatter (title, date, category, applies_when, related, tags).
- Capability matrix has at least 8 rows (one per `SessionEnv` operation: `exec`, `readFile`, `writeFile`, `readdir`, `mkdir`, `rm`, `stat`, `exists`).
- Bedrock routing section names which of the three paths worked OR captures the verbatim error from each attempt.
- Tenant isolation section either cites an AWS doc URL OR records the behavioral-test outcome.
- Recommendation section ends with one of the five outcome labels.

---

## System-Wide Impact

- **Interaction graph:** No production code paths affected. Spike package is new, isolated, and not imported by any existing ThinkWork code. The Flue clone at `/Users/ericodom/Projects/flue/` is external and not part of the ThinkWork repo.
- **Error propagation:** Spike errors surface in the verdict doc verbatim (AWS errors, type errors, runtime errors). No production error paths affected.
- **State lifecycle risks:** AgentCore CI sessions created during the spike are short-lived; cleanup-on-destroy is in U2's connector implementation. Worst case: a few orphaned interpreter sessions in the dev account, which expire on their own per AgentCore CI's session TTL.
- **API surface parity:** None — the spike does not change any existing interface.
- **Integration coverage:** U3 covers the AgentCore CI integration; U4 covers the Bedrock routing integration. These are the only two integration surfaces this spike concerns.
- **Unchanged invariants:** `packages/agentcore-pi/` is not modified. The 2026-04-26 vendoring track continues unaffected by this spike — only the verdict doc + new `packages/flue-aws/` package land in the ThinkWork repo.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| AgentCore CI session creation hits a permission gap | Capture verbatim error in verdict; outcome label = AgentCore-CI-gap-requires-base-image-rebuild or partial-verdict. Spike exits cleanly. |
| `executeCommand` doesn't accept cwd/env/timeout structured args | Document in capability matrix as "wrapped"; verdict label can still be green if all `SessionEnv` ops are reachable via wrap. |
| Flue's `providers` config doesn't accept any of the three Bedrock routing paths | Verdict label = Bedrock-routing-blocked. Brainstorm Next Step #5 fires (re-decide between vendoring track or FR-1/FR-3 carveout). |
| Time budget overrun (>6 hours) | U3's tenant-isolation behavioral test is the easiest cut; cite AWS docs only or skip and mark as "deferred to plan revision". U4's third attempt is also cuttable. |
| AWS dev-account credentials expire mid-spike | Re-resolve via existing `project_dev_db_secret_pattern` (`aws sso login` if SSO, or AWS profile refresh). |
| `pnpm install` for the new package conflicts with existing workspace | New package depends only on `@flue/sdk` (not in current lockfile, will be added) and `@aws-sdk/client-bedrock-agentcore` (already present). Conflict risk is low; if it occurs, pin to existing versions. |

---

## Documentation / Operational Notes

- Verdict doc is a permanent artifact regardless of outcome (origin success criterion).
- The spike's connector code in `packages/flue-aws/` stays in-tree even after the spike — if verdict is green, /ce-plan revision builds on it; if not, the README's "spike-only" framing makes the path-not-taken auditable.
- No deployment, no monitoring, no feature flag — local-execution spike only.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md` (FR-9a)
- **FR-9 verdict (precedent):** `docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md`
- **Existing AgentCore CI client:** `packages/agentcore-pi/agent-container/src/runtime/tools/execute-code.ts`
- **Flue connector pattern:** `/Users/ericodom/Projects/flue/examples/hello-world/.flue/connectors/daytona.ts` (external)
- **Flue type definitions:** `/Users/ericodom/Projects/flue/packages/sdk/dist/types-*.d.mts` (external)
- **Terraform module:** `terraform/modules/app/agentcore-code-interpreter/main.tf`
- **AWS SDK:** `@aws-sdk/client-bedrock-agentcore` (already pinned in `packages/agentcore-pi/package.json`)
