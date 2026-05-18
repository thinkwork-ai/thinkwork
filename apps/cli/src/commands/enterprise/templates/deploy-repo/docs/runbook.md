<!-- thinkwork-managed: enterprise-deploy-template -->

# ThinkWork Enterprise Deployment Runbook

This repository deploys a pinned ThinkWork release into the customer AWS
account. It is a deployment repository, not a source fork.

## Normal Sequence

1. Bootstrap the repo once:

   ```bash
   thinkwork enterprise bootstrap . \
     --customer {{CUSTOMER_SLUG}} \
     --repo <github-owner>/<github-repo> \
     --stage dev \
     --stage prod
   ```

2. Review GitHub Environment settings for each stage.
3. Add required secrets such as `TF_VAR_db_password` and
   `TF_VAR_api_auth_secret`.
4. Dispatch `.github/workflows/deploy.yml`.
5. CI verifies `thinkwork.lock`, prepares release artifacts, runs Terraform,
   updates AgentCore runtimes, applies customer overlays, runs smoke checks,
   and writes a summary artifact.

The exact operational path is:

```text
bootstrap -> workflow dispatch -> CI deploy -> overlay apply -> smoke summary
```

## Release Upgrades

1. Update `thinkwork.lock` to the approved release manifest URL and checksum.
2. Review ThinkWork release notes for schema or operator changes.
3. Dispatch the workflow with `component=all`.
4. Save the deploy summary artifact as evidence.

## Overlay-Only Changes

1. Edit files under `customer/`.
2. Run a local dry-run:

   ```bash
   thinkwork enterprise overlay apply . --stage dev --dry-run --json
   ```

3. Dispatch the workflow with `component=overlays`.
4. Confirm `overlay-report.json` in the workflow artifacts.

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
working release and dispatch the workflow. To roll back customer overlays,
revert the customer repo commit and dispatch `component=overlays`.

If a deploy fails after Terraform apply but before smoke summary, inspect the
workflow artifacts first: `release-manifest.json`, `overlay-report.json`, and
the deploy summary identify which stage failed.

## Break Glass

A full ThinkWork source fork is emergency debt. Use it only when the customer
requires source changes that cannot be shipped upstream quickly enough. Record
the fork reason, owner, and expected upstream PR before deploying it.
