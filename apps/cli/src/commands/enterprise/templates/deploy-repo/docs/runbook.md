<!-- thinkwork-managed: enterprise-deploy-template -->

# ThinkWork Enterprise Deployment Runbook

This repository deploys a pinned ThinkWork release into the customer AWS
account. It is a deployment repository, not a source fork.

The exact operational path is:

```text
bootstrap -> workflow dispatch -> CI deploy -> overlay apply -> smoke summary
```

## First-Time Setup

Run these commands from an operator machine with temporary customer AWS admin
access and GitHub admin access to this repository.

1. Log in and verify readiness:

   ```bash
   thinkwork login
   ```

2. Run the top-level bootstrap:

   ```bash
   thinkwork deploy --bootstrap
   ```

   The CLI prompts for the customer slug, stage, GitHub deployment repo,
   whether to create the repo if it does not exist, and required secret values.
   It creates or reuses the deployment repo checkout, bootstraps dev and prod
   deployment authority, sets GitHub Environment secrets through `gh`, commits
   and pushes managed files, dispatches the dev workflow, waits for the run, and
   prints deploy evidence plus discovered URLs.

3. Deploy again after repo or overlay changes:

   ```bash
   thinkwork deploy
   ```

   Run this from inside the generated deployment repo. From another directory,
   pass `--customer {{CUSTOMER_SLUG}} --stage dev`.

4. Log in to the deployed stack:

   ```bash
   thinkwork login --stage dev --region {{REGION}}
   thinkwork me --stage dev --region {{REGION}}
   ```

## Manual Fallback

Use these commands only when troubleshooting or when you need to split the
one-line flow into explicit steps.

1. Confirm access:

   ```bash
   gh auth status
   aws sts get-caller-identity
   ```

2. Choose the release and checksum:

   ```bash
   VERSION="$(thinkwork --version)"
   RELEASE="v${VERSION#v}"
   MANIFEST_URL="https://github.com/thinkwork-ai/thinkwork/releases/download/${RELEASE}/thinkwork-release.json"
   MANIFEST_SHA256="$(curl -fsSL "$MANIFEST_URL" | shasum -a 256 | awk '{print $1}')"
   ```

3. Bootstrap AWS trust, GitHub Environments, and managed repo files:

   ```bash
   thinkwork enterprise bootstrap . \
     --customer {{CUSTOMER_SLUG}} \
     --repo <github-owner>/<github-repo> \
     --stage dev \
     --stage prod \
     --region {{REGION}} \
     --release-version "$RELEASE" \
     --manifest-url "$MANIFEST_URL" \
     --manifest-sha256 "$MANIFEST_SHA256" \
     --yes
   ```

4. Commit, push, and dispatch manually:

   ```bash
   git add .
   git commit -m "chore: bootstrap ThinkWork deployment repo"
   git push

   gh workflow run deploy.yml \
     --repo <github-owner>/<github-repo> \
     -f stage=dev \
     -f component=all \
     -f run_smokes=true
   ```

5. Watch the run and download evidence:

   ```bash
   RUN_ID="$(gh run list --repo <github-owner>/<github-repo> --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   gh run watch "$RUN_ID" --repo <github-owner>/<github-repo> --exit-status

   mkdir -p "deploy-artifacts/dev-${RUN_ID}"
   gh run download "$RUN_ID" \
     --repo <github-owner>/<github-repo> \
     --name "thinkwork-deploy-dev-${RUN_ID}" \
     --dir "deploy-artifacts/dev-${RUN_ID}"

   jq . "deploy-artifacts/dev-${RUN_ID}/deploy-summary.json"
   jq . "deploy-artifacts/dev-${RUN_ID}/smoke-summary.json"
   ```

6. Deploy production after the `prod` GitHub Environment has required
   approvals and secrets:

   ```bash
   thinkwork deploy --customer {{CUSTOMER_SLUG}} --stage prod --component all
   ```

## Workflow Components

| Component    | What it does                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `all`        | First deploy and normal release upgrades: release artifact prep, Terraform apply, runtime image copy, AgentCore update, static sync, overlays, smokes. |
| `foundation` | Terraform apply and artifact/runtime/static sync without overlays.                                                                                     |
| `artifacts`  | Re-copy pinned Lambda/static/runtime artifacts without Terraform apply.                                                                                |
| `overlays`   | Apply only `customer/` evals, skills, workspace defaults, seeds, and branding records.                                                                 |
| `smokes`     | Run smoke checks against an already-deployed stage.                                                                                                    |

## Overlay-Only Changes

1. Edit files under `customer/`.
2. Validate locally:

   ```bash
   thinkwork enterprise overlay apply . --stage dev --region {{REGION}} --dry-run --json
   ```

3. Commit and push:

   ```bash
   git add customer
   git commit -m "chore: update customer ThinkWork overlays"
   git push
   ```

4. Dispatch:

   ```bash
   thinkwork deploy --customer {{CUSTOMER_SLUG}} --stage dev --component overlays --no-run-smokes
   ```

## Release Upgrades

1. Update `thinkwork.lock`:

   ```bash
   VERSION="0.12.5"
   RELEASE="v${VERSION#v}"
   MANIFEST_URL="https://github.com/thinkwork-ai/thinkwork/releases/download/${RELEASE}/thinkwork-release.json"
   MANIFEST_SHA256="$(curl -fsSL "$MANIFEST_URL" | shasum -a 256 | awk '{print $1}')"

   tmp="$(mktemp)"
   jq \
     --arg release "$RELEASE" \
     --arg manifestUrl "$MANIFEST_URL" \
     --arg manifestSha256 "$MANIFEST_SHA256" \
     --arg terraformModuleVersion "${RELEASE#v}" \
     '.thinkwork.release = $release
      | .thinkwork.manifestUrl = $manifestUrl
      | .thinkwork.manifestSha256 = $manifestSha256
      | .thinkwork.terraformModuleVersion = $terraformModuleVersion
      | .artifacts.lambdaPrefix = ("releases/" + $release + "/lambdas")' \
     thinkwork.lock > "$tmp"
   mv "$tmp" thinkwork.lock
   ```

2. Commit and deploy to dev:

   ```bash
   git add thinkwork.lock
   git commit -m "chore: bump ThinkWork to ${RELEASE}"
   git push

   thinkwork deploy --customer {{CUSTOMER_SLUG}} --stage dev --component all
   ```

3. Deploy to production after dev passes.

## Secrets

Never commit secrets. Supported secret homes are:

- GitHub Environment secrets for CI inputs.
- AWS Secrets Manager for deployed application/runtime secrets.
- SSM Parameter Store for stage configuration consumed by Terraform or runtime
  code.

Do not store plaintext secrets in `terraform/stages/*.tfvars`, `.env`,
`customer/`, or runbook files.

## Rollback

To roll back application code, restore `thinkwork.lock` to the previously
working release and dispatch the workflow with `component=all`.

To roll back customer overlays, revert the customer repo commit and dispatch
the workflow with `component=overlays`.

If a deploy fails after Terraform apply but before smoke summary, inspect the
workflow artifact first. `deploy-summary.json`, `overlay-report.json`, and
`smoke-summary.json` identify which stage failed.

## Break Glass

A full ThinkWork source fork is emergency debt. Use it only when the customer
requires source changes that cannot be shipped upstream quickly enough. Record
the fork reason, owner, and expected upstream PR before deploying it.
