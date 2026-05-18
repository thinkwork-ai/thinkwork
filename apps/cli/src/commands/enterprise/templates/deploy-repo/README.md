<!-- thinkwork-managed: enterprise-deploy-template -->

# {{CUSTOMER_SLUG}} ThinkWork Deployment

This repository deploys a pinned ThinkWork foundation into the customer AWS
account. It is intentionally not a fork of the ThinkWork source monorepo:
`thinkwork.lock` pins a release manifest, Terraform consumes published release
artifacts, and customer-specific work lives under `customer/`.

## Deployment Model

- GitHub Actions deploys through AWS OIDC and per-stage GitHub Environments.
- `terraform/stages/*.tfvars` contains non-secret stage configuration.
- Secrets stay in GitHub Environment secrets, AWS Secrets Manager, or SSM.
- `customer/deployment.json` declares which customer overlays apply to each
  stage.

## First-Time Setup

1. Run `thinkwork enterprise bootstrap` from an admin machine with temporary
   AWS bootstrap access.
2. Review the generated GitHub Environments for `dev` and `prod`.
3. Add required environment secrets, including `TF_VAR_db_password` and
   `TF_VAR_api_auth_secret`.
4. Dispatch `.github/workflows/deploy.yml` for the target stage.

## Customer Overlay

Place customer-specific eval packs, seeds, skills, workspace defaults, and
branding assets under `customer/`. Reusable platform behavior should be built
upstream in ThinkWork and adopted here by bumping `thinkwork.lock`.
