---
title: "Lambda rejects multi-arch manifest lists; AgentCore Runtime needs arm64 — split to single-platform tags"
module: .github/workflows/deploy.yml
date: 2026-04-24
problem_type: build_error
component: deployment
severity: high
symptoms:
  - "`docker/build-push-action` with `platforms: linux/amd64,linux/arm64` pushes a manifest list successfully to ECR"
  - "`aws lambda update-function-code --image-uri ${sha}` fails with: `InvalidParameterValueException: The image manifest, config or layer media type for the source image ... is not supported.`"
  - "`aws bedrock-agentcore-control update-agent-runtime` against an amd64-only image fails with: `ValidationException: Architecture incompatible for uri ... Supported architectures: [arm64]`"
  - "The two consumers of the same repo want incompatible image formats from one another"
root_cause: implementation_bug
resolution_type: ci_fix
related_components:
  - deployment
tags:
  - docker
  - buildx
  - ecr
  - lambda
  - agentcore-runtime
  - multi-arch
  - arm64
  - manifest-list
last_updated: 2026-04-24
---

# Lambda rejects multi-arch manifest lists; AgentCore Runtime needs arm64 — split to single-platform tags

## Problem

A single ECR repository (`thinkwork-${stage}-agentcore`) feeds two unrelated consumers:

- **Lambda `thinkwork-${stage}-agentcore`** — a container-image Lambda. Configured with `Architectures: [x86_64]`. `UpdateFunctionCode` pulls the image at the supplied `--image-uri` and rejects any manifest that isn't a plain Docker v2 single-platform image:

  ```
  InvalidParameterValueException: The image manifest, config or layer media type
  for the source image ... is not supported.
  ```

- **Bedrock AgentCore Runtime** — running a managed arm64 container. `UpdateAgentRuntime` rejects any image whose arch isn't arm64:

  ```
  ValidationException: Architecture incompatible for uri ...
  Supported architectures: [arm64]
  ```

If `docker/build-push-action` is told `platforms: linux/amd64,linux/arm64`, it pushes a **manifest list** at the tag — one index pointing at two per-arch child manifests. Lambda can't parse the list format at all; AgentCore Runtime tries to resolve the list, picks the arm64 child, but the validation happens on the top-level manifest so it still fails in some SDK paths.

Two consumers, two incompatible manifest-format requirements. One repo, one tag namespace. The naive "just build multi-arch" fix doesn't work.

## Symptoms

- `build-push-action` step completes successfully; ECR shows the tag
- **`Update Lambda function code` step fails** with the `InvalidParameterValueException` above (exit 254)
- Because `build-container` fails, `Update AgentCore Runtime` step never runs (it's sequenced after)
- `aws ecr describe-images --image-ids imageTag=<tag>` shows `imageManifestMediaType: application/vnd.docker.distribution.manifest.list.v2+json` — that's the rejected format
- Single-platform image at the same tag would be `application/vnd.docker.distribution.manifest.v2+json`

## What Didn't Work

- **`platforms: linux/amd64`** (pre-fix) — Lambda happy, but AgentCore Runtime won't accept the image; every `UpdateAgentRuntime` call gets "Architecture incompatible". Silent because the runtime just keeps serving its previously-pinned image (see `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`).
- **`platforms: linux/amd64,linux/arm64`** (#489) — AgentCore Runtime could pick arm64 from the manifest list, but Lambda blew up on the list format itself. This was PR #490's discovery mid-deploy.
- **Digest-pinned single-arch for Lambda** — buildx exposes per-platform digests via metadata output. Doable but fiddly: requires extracting the amd64 digest from the build step's output, passing it to `update-function-code` as `--image-uri <repo>@sha256:<digest>`. Breaks the "SHA tag == image URI" convention the rest of the stack assumes.

## Resolution

**Emit two separate SHA-tagged images**, one per platform, from two sequential `docker/build-push-action` steps in the same `build-container` job:

| Tag | Platform | Consumer |
|---|---|---|
| `${sha}` + `latest` | `linux/amd64` | Lambda `thinkwork-${stage}-agentcore` |
| `${sha}-arm64` + `latest-arm64` | `linux/arm64` | Bedrock AgentCore Runtime |

Each step uses a distinct GHA cache scope (`cache-to: type=gha,scope=amd64` / `scope=arm64`) so cache layers don't cross-contaminate. The Lambda `update-function-code` step uses `${sha}` (amd64); the `UpdateAgentRuntime` step uses `${sha}-arm64`.

Implemented in PR #490. See `.github/workflows/deploy.yml`'s `build-container` job.

## Prevention

1. **Explicit platform in IAM comments/docs**: the runtime module's README should name the arm64 requirement so next-hand-touches see it before ECR's error message reaches them.
2. **Don't cross-wire consumers to tags**: the split-tag scheme needs the Lambda step and the runtime step to reference distinct tags. A refactor that centralizes "the current image tag" into one variable reintroduces the ambiguity. Keep `${sha}` and `${sha}-arm64` as two separate variables.
3. **Consider native arm64 runners** (e.g., `ubuntu-24.04-arm` on GHA) to cut QEMU emulation time. The arm64 cross-build under QEMU on an amd64 runner triples build time (~18 min vs ~6 min native); a per-platform matrix strategy on native runners would also eliminate the cross-contamination risk.

## Related Learnings

- `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md` — even after this fix lands, the runtime still needs an explicit `UpdateAgentRuntime` call to pick up new images.
