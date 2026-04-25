---
title: "Stale AgentCore runtime image kept crashing on missing opentelemetry-instrument"
date: 2026-04-25
category: runtime-errors
module: .github/workflows/deploy.yml, scripts/post-deploy.sh, packages/agentcore-strands/agent-container
problem_type: runtime_error
component: assistant
symptoms:
  - "AgentCore Runtime.InvalidEntrypoint: exec: \"opentelemetry-instrument\": executable file not found in $PATH"
  - "Thread 937deddf-153e-4f55-9c95-8d4ba5b539ea failed before the Strands runtime could answer"
  - "Post-deploy drift verification reported clean while the active runtime image was still an older source SHA"
  - "Container rebuild was skipped because the latest deploy did not touch container paths"
  - "Recovery build was blocked by nova-act>=3.0 conflicting with strands-agents-tools>=0.3.0"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: high
related_components:
  - "development_workflow"
  - "tooling"
  - "testing_framework"
tags:
  - agentcore
  - strands
  - stale-container-image
  - post-deploy
  - runtime-entrypoint
  - dependency-resolution
---

# Stale AgentCore runtime image kept crashing on missing opentelemetry-instrument

## Problem

The dev AgentCore Strands runtime was pinned to an old container image that crashed at startup with `Runtime.InvalidEntrypoint` because `opentelemetry-instrument` was not present in `$PATH`. The source fix for the entrypoint dependency already existed, but the deployed runtime image predated it and the deploy pipeline had no guard that proved the active runtime image contained the required source SHA.

The visible failure was a broken chat thread: `937deddf-153e-4f55-9c95-8d4ba5b539ea` returned the generic assistant error after AgentCore failed before the Python runtime could start.

## Symptoms

- AgentCore returned:

  ```text
  Runtime.InvalidEntrypoint:
  exec: "opentelemetry-instrument": executable file not found in $PATH
  ```

- The live dev runtime was `READY` on version `35`, but its image was still:

  ```text
  92fbf1e96861f72153c7cf21942daf6ef3c42ab6-arm64
  ```

- That image source SHA predated the entrypoint guard from PR #581.
- `scripts/post-deploy.sh` reported no runtime drift because endpoint and runtime versions matched; it did not verify source-image freshness.
- A new image build initially failed dependency resolution because `nova-act>=3.0` required `strands-agents-tools<=0.2.22` while the runtime required `strands-agents-tools>=0.3.0`.

## What Didn't Work

- **Relying on the earlier entrypoint fix.** The code fix existed in source, but the live runtime was pinned to an image that did not contain it.
- **Re-running deploys gated only by path changes.** The deploy that contained the entrypoint guard was cancelled. The next deploy did not touch container paths, so the `build-container` job skipped the image build and `UpdateAgentRuntime` path.
- **Trusting runtime `READY` and endpoint version agreement.** Those checks only said AgentCore was serving its current image consistently. They did not say the image was recent enough.
- **Installing Nova Act in the runtime image.** `nova-act>=3.0` made the Python environment unsatisfiable because it pinned `strands-agents-tools<=0.2.22`. Browser Automation imports Nova Act lazily, so it did not need to be a boot-time dependency.
- **A broad deploy canary from prior planning.** A previous Codex session considered a generic post-deploy smoke gate, but rejected it as too broad and bypass-heavy for this class of work (session history). The targeted fix here is narrower: verify a known AgentCore deployment invariant, not every product path.

## Solution

PR #585 made the deploy pipeline source-aware and removed the dependency conflict.

In `.github/workflows/deploy.yml`, `detect-changes` now fetches full history and computes the latest source commit that should be represented in the AgentCore image:

```yaml
fetch-depth: 0
```

```bash
SHA=$(git log -1 --format=%H -- \
  packages/agentcore-strands \
  packages/agentcore \
  .github/workflows/deploy.yml)
```

The workflow then reads the active Strands runtime ID from SSM, inspects its container image tag, extracts the embedded source SHA, and marks the runtime stale when the active image does not include the required source commit:

```bash
if [ -n "$IMAGE_SHA" ] &&
  git cat-file -e "${IMAGE_SHA}^{commit}" 2>/dev/null &&
  git merge-base --is-ancestor "$SOURCE_SHA" "$IMAGE_SHA"; then
  echo "stale=false" >> "$GITHUB_OUTPUT"
else
  echo "stale=true" >> "$GITHUB_OUTPUT"
fi
```

`build-container` now runs when any of these are true:

```text
container paths changed
OR workflow_dispatch
OR runtime_container_stale
```

`scripts/post-deploy.sh` gained `--min-source-sha`. In strict mode, it fails the active SSM runtime when its image SHA does not include the required source SHA:

```bash
bash scripts/post-deploy.sh \
  --stage dev \
  --region us-east-1 \
  --min-source-sha "$container_source_sha" \
  --strict
```

The check uses commit ancestry rather than exact equality:

```bash
git merge-base --is-ancestor "$required_source_sha" "$image_source_sha"
```

That lets a newer image satisfy an older required source commit while still catching stale images.

The recovery build was unblocked by removing `nova-act>=3.0` from `packages/agentcore-strands/agent-container/requirements.txt`:

```text
# nova-act currently pins strands-agents-tools<=0.2.22, which conflicts with
# the sandbox/runtime stack's >=0.3.0 requirement and makes the whole image
# unsatisfiable. Browser Automation imports Nova Act lazily and returns a clear
# unavailable message while this optional dependency is absent.
```

Regression coverage went into `scripts/post-deploy.test.sh`. It uses fake AWS responses plus the real git commit graph to assert that:

- a stale active runtime image fails when `--min-source-sha` requires a newer source commit
- a fresh active runtime image passes
- stale orphan runtimes do not fail strict checks

## Why This Works

The old deploy logic answered two weaker questions:

- Did this particular push touch container paths?
- Do the runtime and endpoint agree on the same AgentCore version?

The cancelled-deploy failure slips between those checks. Source had advanced, but the later deploy did not rebuild because the current diff did not touch container paths. AgentCore was internally consistent, but consistently serving an old image.

The new logic answers the question that mattered: does the active runtime image contain the latest source commit relevant to the AgentCore container? If not, the pipeline forces a fresh build and `UpdateAgentRuntime`.

The GraphQL E2E proof also used the canonical product path, not a guessed warm-runtime path: `sendMessage` on the existing thread invoked the chat agent through the deployed backend and produced a real assistant reply. Prior session history specifically warned that AgentCore wakeups should be validated through the actual wakeup/container path rather than assumptions about persistent runtime sessions.

## Prevention

- Verify deployed image source ancestry, not only runtime `READY` or endpoint version agreement.
- Keep `--min-source-sha` wired into deploy summaries so source-image drift fails loudly after deploy.
- Treat optional runtime tools as lazy dependencies when their pins conflict with the core Strands stack.
- Keep `scripts/post-deploy.test.sh` close to the deploy invariant: active stale images should fail, fresh active images should pass, stale orphan runtimes should be ignored.
- Prove runtime fixes with a real GraphQL `sendMessage` on an agent-backed thread when possible.

Useful checks:

```bash
bash -n scripts/post-deploy.sh scripts/post-deploy.test.sh
bash scripts/post-deploy.test.sh
uv pip compile packages/agentcore-strands/agent-container/requirements.txt \
  -q \
  -o /tmp/thinkwork-agentcore-requirements.lock
uv run --no-project \
  --with-requirements packages/agentcore-strands/agent-container/requirements.txt \
  --with pytest \
  pytest \
  packages/agentcore-strands/agent-container/test_boot_assert.py \
  packages/agentcore-strands/agent-container/test_browser_automation_tool.py \
  packages/agentcore-strands/agent-container/test_write_memory_tool.py \
  -q
```

The verified recovery advanced dev to runtime version `36` on image:

```text
bc65aefa59e6d225602b3f1e580e4949fb55f015-arm64
```

The E2E GraphQL proof on thread `937deddf-153e-4f55-9c95-8d4ba5b539ea` produced succeeded turn `fe4fd38a-231a-4585-ba52-4ffc2fc54ee7` and assistant reply `2f1352e5-8ba8-4bdb-88b7-a34f3e38a37e`.

## Related Issues

- PR #581: `fix(agentcore): guard container entrypoint dependencies`
- PR #585: `fix(agentcore): rebuild stale runtime images`
- PR #507: post-deploy probe for AgentCore Strands runtime drift
- PR #502: container commit-SHA marker
- PR #489: update Bedrock AgentCore runtime during deploy
- PR #490: split amd64 Lambda and arm64 AgentCore image tags
- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`
- `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`
- `docs/solutions/build-errors/multi-arch-image-lambda-vs-agentcore-split-tags-2026-04-24.md`
- `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md`
