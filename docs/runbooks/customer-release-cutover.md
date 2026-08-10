# Customer release cutover — `thinkwork release deploy` + skill seed

Proven end-to-end 2026-08-09 shipping v0.1.0-canary.449 to `tei-e2e` (acct 637423202447) and `mcpherson` (acct 024350822488). This is the CLI path; the Settings → Releases UI (`docs/runbooks/settings-release-upgrades.md`) is the operator-facing equivalent.

> **History**: the 2026-07-06 version of this runbook documented a manual docker Pi-image mirror plus a raw `thinkwork deploy --controller` invocation. Both are obsolete — see "What changed" at the bottom, because the old deploy path now **fails by design** and the failure message doesn't name this fix.

## 0. Preconditions

- A `v0.1.0-canary.N` tag whose `release.yml` run completed (GitHub release has `thinkwork-release.json` + `platform-artifacts.tar.gz`, and the `Mirror arm64 Pi image (<stage>)` jobs succeeded for every customer target).
- AWS profiles for each customer account. No docker, no dev-ECR access — the image mirror is CI's job now.

## 1. Cut the release (if not already tagged)

Nothing auto-mints canary tags (`canary-release-tagging-web-desktop-2026-06-11.md`). Tag the merged main and push:

```bash
git fetch --tags && git tag --sort=-creatordate | head -3   # find next N
git tag v0.1.0-canary.N origin/main && git push origin v0.1.0-canary.N
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

`release.yml` builds the platform artifacts **and mirrors the arm64 Pi image into every customer ECR** listed in `.github/release-mirror-targets.json` (THINK-616). Adding a new enterprise account to that file is the only change needed for it to inherit the mirror.

## 2. Deploy per stack — one command

```bash
AWS_REGION=us-east-1 AWS_PROFILE=<profile> thinkwork release deploy v0.1.0-canary.N -s <stage> -y
# add --no-wait to start the controller execution and poll yourself:
#   aws stepfunctions describe-execution --execution-arn <printed-arn>
# add --web-only to sync only the web static bundle (no terraform, no Pi pin needed)
```

`thinkwork release deploy` (CLI ≥ 0.13) resolves the manifest URL + sha256 from the GitHub release itself and — critically — **recovers the prior successful controller input from the stack's deployment history**, carrying forward the non-derivable environment facts: the customer-ECR `agentcorePiSourceImageUri` pin, AgentCore Harness configuration, and feature flags. Bare `thinkwork release -s <stage>` prompts over the last five releases.

Do **not** use `thinkwork deploy --controller --controller-action update` for a customer release. It builds a fresh controller input with no Pi pin, and the runner refuses it:

```
RuntimeError: Customer foundation updates require an explicit customer-ECR
agentcorePiSourceImageUri; refusing to fall back to the release registry.
```

That guard is intentional (`runner.py: resolve_agentcore_pi_source_image_uri` — customer stacks must never pull the release registry's image at apply time). The raw deploy path remains correct only for greenfield installs and dev stacks.

## 3. Verify per stack

```bash
aws ssm get-parameter --name /thinkwork/<stage>/deployment/selected-release-version --profile <p> --region us-east-1
# Pi Lambda resolved digest must match the mirrored image:
aws lambda get-function --function-name thinkwork-<stage>-agentcore-pi --profile <p> --region us-east-1 --query 'Code.ResolvedImageUri'
```

Customer Pi is **Lambda-hosted** — there is no Bedrock AgentCore runtime and no `UpdateAgentRuntime` step on these stacks.

If the release adds a **new runner-wired terraform variable** (vars_json allowlist + generated-root declaration + module argument), also verify the value actually landed — a green run does not prove it (see the runner-lag trap below):

```bash
aws ssm get-parameter --name /thinkwork/<stage>/runtime-config --profile <p> --region us-east-1 --query Parameter.Value --output text | jq 'keys'
```

## 4. Default-skill content (customer deploys do NOT run the seeder)

If the release changed default-skill content, run the seed one-off per stack (pattern in `docs/solutions/integration-issues/default-skill-content-updates-never-reach-agents-…`):

- Must run **inside `packages/api`** (ESM, top-level await) with `DATABASE_URL` (customer Aurora is laptop-reachable, `PGSSLMODE=require`), `WORKSPACE_BUCKET=thinkwork-<stage>-storage`, `SKILL_TRUST_RUNNER_FUNCTION_NAME=thinkwork-<stage>-skill-trust-runner`, and the stack's AWS profile.
- **From an up-to-date checkout** — the seeder publishes the LOCAL workspace-defaults canon; a stale checkout silently reports "already current" while seeding old content.
- Post-#3408 the seeder auto-re-materializes stale workspace copies; verify with a byte check of the workspace `SKILL.md`.

## Known traps

- **Release N runs with the runner staged by release N−1** — the CodeBuild runner fetches its script from the evidence bucket at build start, and that S3 object is updated by the run itself. A release that adds a new runner-wired terraform variable therefore half-applies silently on its first pass (new vars fall back to defaults, runtime-config keys missing, run still green). Fix: run the identical `thinkwork release deploy` a second time (idempotent), or ship the runner.py change one release ahead. Observed live 2026-08-10 with v0.1.0-canary.450 on both stacks (`docs/solutions/integration-issues/release-deploy-runner-script-lags-one-release.md`).
- Runner self-updates only after a successful run; a stack stuck on a broken runner needs the hot-stage unblock (`runner-guardrail-preconditions-need-bootstrap-fallback-2026-07-04.md`).
- n8n cert/DNS preservation and the `agent_step_bridge_credential` guardrail history: PR #3344.
- A failed controller execution fails **fast and clean** on the Pi-pin guard (before any terraform), so a guard failure leaves the stack untouched — rerun with `thinkwork release deploy`, no cleanup needed (observed live 2026-08-09 on both stacks).

## What changed since 2026-07-06 (why the old steps are gone)

1. **Manual Pi-image mirror → CI**: `release.yml`'s `mirror-customer-images` job (THINK-616) pushes the arm64 Pi image into each customer ECR under `<releaseVersion>-pi-arm64`, driven by `.github/release-mirror-targets.json`. The docker/dev-ECR pre-mirror is no longer part of the cutover.
2. **Raw controller deploy → `thinkwork release deploy`**: the runner now hard-refuses customer foundation updates without a customer-ECR Pi pin, and only the release command recovers that pin from deployment history (`apps/cli/src/commands/release/helpers.ts: recoverPriorControllerInput` / `buildControllerUpdateInput`).
