# Customer release cutover — controller deploy + Pi image mirror + skill seed

Proven end-to-end 2026-07-06 shipping v0.1.0-canary.320 to `tei-e2e` (acct 637423202447) and `mcpherson` (acct 024350822488). This is the CLI path; the Settings → Releases UI (`docs/runbooks/settings-release-upgrades.md`) is the operator-facing equivalent.

## 0. Preconditions

- A `v0.1.0-canary.N` tag whose `release.yml` run completed (GitHub release has `thinkwork-release.json` + `platform-artifacts.tar.gz`).
- AWS profiles for each customer account; docker running; access to the dev ECR (for the image mirror).

## 1. Pre-mirror the Pi image (do this BEFORE the deploy)

The runner's terraform mirror step pulls the release Pi image from **GHCR, which is private to customer CodeBuild runners** — the pull fails and the step silently keeps the existing `pi-latest` (`terraform/modules/app/agentcore-pi/main.tf` WARN path). Pre-pushing the new image into the customer ECR turns that "keep existing" fallback into "keep the new image":

```bash
# amd64 — customer Pi is Lambda-hosted on amd64. The dev ECR's <sha>-pi tag is
# the same build; use it when GHCR read:packages scope is unavailable.
SRC=487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:<git-sha>-pi
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 487219502366.dkr.ecr.us-east-1.amazonaws.com
docker pull $SRC
for each stack:
  aws ecr get-login-password --profile <p> --region us-east-1 | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com
  docker tag $SRC <acct>.dkr.ecr.us-east-1.amazonaws.com/thinkwork-<stage>-agentcore:pi-latest
  docker tag $SRC <acct>.dkr.ecr.us-east-1.amazonaws.com/thinkwork-<stage>-agentcore:<release-tag>-pi-amd64
  docker push both tags
```

## 2. Controller deploy per stack

```bash
TAG=v0.1.0-canary.N
URL="https://github.com/thinkwork-ai/thinkwork/releases/download/$TAG/thinkwork-release.json"
SHA=$(curl -sL "$URL" | shasum -a 256 | awk '{print $1}')
AWS_REGION=us-east-1 AWS_PROFILE=<profile> thinkwork deploy \
  --controller --controller-action update -s <stage> \
  --release-version "$TAG" --manifest-url "$URL" --manifest-sha256 "$SHA"
# → prints the Step Functions execution ARN; poll describe-execution until SUCCEEDED.
```

## 3. Verify per stack

```bash
aws ssm get-parameter --name /thinkwork/<stage>/deployment/selected-release-version --profile <p> --region us-east-1
# Pi Lambda resolved digest must match the mirrored image:
aws lambda get-function --function-name thinkwork-<stage>-agentcore-pi --profile <p> --region us-east-1 --query 'Code.ResolvedImageUri'
```

Customer Pi is **Lambda-hosted** — there is no Bedrock AgentCore runtime and no `UpdateAgentRuntime` step on these stacks.

## 4. Default-skill content (customer deploys do NOT run the seeder)

If the release changed default-skill content, run the seed one-off per stack (pattern in `docs/solutions/integration-issues/default-skill-content-updates-never-reach-agents-…`):

- Must run **inside `packages/api`** (ESM, top-level await) with `DATABASE_URL` (customer Aurora is laptop-reachable, `PGSSLMODE=require`), `WORKSPACE_BUCKET=thinkwork-<stage>-storage`, `SKILL_TRUST_RUNNER_FUNCTION_NAME=thinkwork-<stage>-skill-trust-runner`, and the stack's AWS profile.
- **From an up-to-date checkout** — the seeder publishes the LOCAL workspace-defaults canon; a stale checkout silently reports "already current" while seeding old content.
- Post-#3408 the seeder auto-re-materializes stale workspace copies; verify with a byte check of the workspace `SKILL.md`.

## Known traps

- Runner self-updates only after a successful run; a stack stuck on a broken runner needs the hot-stage unblock (`runner-guardrail-preconditions-need-bootstrap-fallback-2026-07-04.md`).
- n8n cert/DNS preservation and the `agent_step_bridge_credential` guardrail history: PR #3344.
