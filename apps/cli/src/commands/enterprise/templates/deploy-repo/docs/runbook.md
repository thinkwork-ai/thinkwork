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

1. Confirm access:

   ```bash
   gh auth status
   aws sts get-caller-identity
   ```

2. Install the CLI:

   ```bash
   npm install -g thinkwork-cli
   thinkwork --version
   ```

3. Choose the release and checksum:

   ```bash
   VERSION="$(thinkwork --version)"
   RELEASE="v${VERSION#v}"
   MANIFEST_URL="https://github.com/thinkwork-ai/thinkwork/releases/download/${RELEASE}/thinkwork-release.json"
   MANIFEST_SHA256="$(curl -fsSL "$MANIFEST_URL" | shasum -a 256 | awk '{print $1}')"
   ```

4. Bootstrap AWS trust, GitHub Environments, and managed repo files:

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

5. Commit and push generated files:

   ```bash
   git add .
   git commit -m "chore: bootstrap ThinkWork deployment repo"
   git push
   ```

6. Set required GitHub Environment secrets for each stage:

   ```bash
   gh secret set TF_VAR_DB_PASSWORD \
     --repo <github-owner>/<github-repo> \
     --env dev \
     --body "$DEV_DB_PASSWORD"

   gh secret set TF_VAR_API_AUTH_SECRET \
     --repo <github-owner>/<github-repo> \
     --env dev \
     --body "$DEV_API_AUTH_SECRET"
   ```

   Repeat for `prod` before the production deploy.

7. Verify GitHub Environment variables:

   ```bash
   gh variable list --repo <github-owner>/<github-repo> --env dev
   gh variable list --repo <github-owner>/<github-repo> --env prod
   ```

   Expected variables are `AWS_REGION`, `AWS_ROLE_ARN`, and
   `THINKWORK_ARTIFACT_BUCKET`.

8. Review stage config:
   - `terraform/stages/dev.tfvars`
   - `terraform/stages/prod.tfvars`
   - `customer/deployment.json`

   Do not commit plaintext secrets to `terraform/stages/*.tfvars`,
   `customer/`, `.env`, or this runbook.

9. Dispatch the first deploy:

   ```bash
   gh workflow run deploy.yml \
     --repo <github-owner>/<github-repo> \
     -f stage=dev \
     -f component=all \
     -f run_smokes=true
   ```

10. Watch the run and download evidence:

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

11. Log in to the deployed stack:

    ```bash
    thinkwork login --stage dev --region {{REGION}}
    thinkwork me --stage dev --region {{REGION}}
    ```

12. Deploy production after the `prod` GitHub Environment has required
    approvals and secrets:

    ```bash
    gh workflow run deploy.yml \
      --repo <github-owner>/<github-repo> \
      -f stage=prod \
      -f component=all \
      -f run_smokes=true
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
   gh workflow run deploy.yml \
     --repo <github-owner>/<github-repo> \
     -f stage=dev \
     -f component=overlays \
     -f run_smokes=false
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

   gh workflow run deploy.yml \
     --repo <github-owner>/<github-repo> \
     -f stage=dev \
     -f component=all \
     -f run_smokes=true
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
