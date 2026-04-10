# Contributing to Thinkwork

Thanks for your interest in Thinkwork. A few things to know before you open an issue or PR.

## Scope

Thinkwork is **AWS-native by design**. It uses Cognito, AppSync, Aurora Postgres, Bedrock/AgentCore, Lambda, Step Functions, S3, and Terraform. We deliberately do not support non-AWS substrates, and we will politely decline feature requests, issues, and PRs that assume Kubernetes, Docker Compose, GCP, Azure, or other non-AWS deployment targets.

If you want a generic self-hosted agent framework, there are several great projects that target that audience. Thinkwork is the one for the AWS-shop niche.

## Before opening an issue

1. **Search existing issues and discussions** — your topic may already be covered.
2. **For bugs:** include reproduction steps, the version (`thinkwork version`), the AWS region, and any relevant CloudWatch log excerpts. Redact secrets.
3. **For feature requests:** explain the use case first, the proposed solution second. We're more likely to help with a clear problem statement than with a pre-baked solution.
4. **For questions:** use [GitHub Discussions](https://github.com/thinkwork-ai/thinkwork/discussions) instead of issues.

## Before opening a PR

1. **Open an issue first** for anything non-trivial. We'd rather discuss approach before you write code.
2. **Sign your commits** (`git commit -s`) — we use the [Developer Certificate of Origin](https://developercertificate.org/).
3. **Write tests.** New features need tests. Bug fixes need a test that fails on `main` and passes with the fix.
4. **Run the checks locally** before pushing:
   ```bash
   pnpm install
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm format:check
   ```
5. **Keep PRs focused.** One topic per PR. Refactors and feature changes go in separate PRs.
6. **Update docs** for any user-visible change. Docs live in `docs/`.

## Repo layout

```
apps/        # runnable products (hive, mobile, cli)
packages/    # shared libraries
terraform/   # IaC modules + reference examples
examples/    # runnable reference packs
docs/        # Astro Starlight docs site source
scripts/     # build, release, migration scripts
.github/     # workflows and issue/PR templates
```

## Development environment

- **Node** ≥ 20, **pnpm** ≥ 9 — `pnpm install` from the repo root
- **Python** ≥ 3.11 with **uv** for the Strands runtime under `packages/agentcore-strands/`
- **Terraform** ≥ 1.5 (or **OpenTofu** ≥ 1.6) for the IaC layer
- **An AWS account** for end-to-end testing — there is no local-only mode

## Code style

- TypeScript: ESLint + Prettier (config in repo root once Phase 0 wraps)
- Python: Ruff (config in `pyproject.toml`)
- Terraform: `terraform fmt` + `tflint` + `checkov`
- Commit messages: [Conventional Commits](https://www.conventionalcommits.org/) format (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)

## Reporting security issues

**Do not** open a public issue for security vulnerabilities. See [SECURITY.md](./SECURITY.md) for the disclosure process.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Be kind.

## License

By contributing, you agree that your contributions will be licensed under the MIT license that covers the project.
