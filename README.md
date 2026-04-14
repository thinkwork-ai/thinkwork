<p align="center">
  <img src="./docs/src/assets/logo.png" alt="Thinkwork" width="240" />
</p>

<h1 align="center">Thinkwork</h1>

<p align="center"><strong>Production-grade open agent harness for teams that already live on AWS.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/thinkwork-cli"><img src="https://img.shields.io/npm/v/thinkwork-cli.svg?color=0ea5e9&label=thinkwork-cli" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license" /></a>
  <a href="https://docs.thinkwork.ai"><img src="https://img.shields.io/badge/docs-thinkwork.ai-0ea5e9" alt="docs" /></a>
</p>

---


Thinkwork makes agent infrastructure easy without handing the harness to a black-box vendor. Threads run the work, memory carries context forward, controls keep it safe, agents and connectors plug into the same system, and the whole thing drops into your existing AWS account via Terraform.

Five commands, one AWS account, and you own a production-quality agent runtime that stays open, portable, and under your control.

If you're not on AWS, this isn't the right tool for you — and that's the point. No Kubernetes, no third-party SaaS control plane, no tire-kicker mode.

## Status

🚧 **Pre-release.** v0.1.0 is in active migration from the closed-source maniflow codebase. See [PRD-47 in the maniflow repo](https://github.com/maniflow-ai/maniflow/blob/main/prds/prd-47-thinkwork-oss-cutover.md) for the full migration plan and the eleven-phase rollout. Watch this repo for the v0.1.0 release.

## What ships in v1

- **Six product modules:** Agents, Threads, Connectors, Automations, Control, Memory
- **Two clients:** an admin/operator web app (`apps/admin`) and a mobile client (`apps/mobile`, Expo)
- **A real CLI** (`thinkwork-cli`) for `login`, `init`, `deploy`, `doctor`, `plan`, `bootstrap`, `destroy`, `status`, `outputs`, `config`, `mcp`, and `tools`
- **Three connectors at launch:** Slack, GitHub, Google Workspace
- **Agentic Tasks** and **Question Cards** for structured task intake and execution
- **Memory** as the umbrella layer for document knowledge, long-term memory, retrieval context, and portable memory contracts
- **Agent Templates** for fleet-wide configuration
- **Terraform Registry modules** at `thinkwork-ai/thinkwork/aws` — drops into your existing AWS Landing Zone with BYO-everywhere support

## What's not in v1

Knowledge Graph + Ontology Studio, AutoResearch, the eval UI, cost tracking, the places service, and a web end-user client are all on the roadmap but not in v0.1.0. We ship things only after they're load-bearing in production. See the docs roadmap page once docs ship.

## Quick start

```bash
npm install -g thinkwork-cli
thinkwork login
thinkwork init -s dev
thinkwork deploy -s dev
thinkwork doctor -s dev
```

Five commands, one AWS account, and you own a production-grade agent harness instead of renting a black box. Full walkthrough in the [Getting Started guide](https://docs.thinkwork.ai/getting-started/).

## Repo layout

```
thinkwork/
  apps/        # runnable products: admin (web), mobile (Expo), cli
  packages/    # shared libraries
  terraform/   # IaC modules (registry-shaped) and reference examples
  examples/    # runnable reference packs: skill-pack, eval-pack, connector-recipe
  docs/        # Astro Starlight docs site source
  scripts/     # build, release, migration scripts
  .github/     # workflows and templates
```

## Technology

TypeScript (apps, packages, CLI, docs) + Python (Strands agent runtime) + Terraform (HCL, OpenTofu-compatible). Aurora Postgres + Bedrock + AppSync + Cognito + Lambda + Step Functions + S3 + CloudFront.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and discussions are open. Note the AWS-native scope — feature requests that assume a non-AWS substrate will be politely declined.

## Security

See [SECURITY.md](./SECURITY.md) for vulnerability disclosure.

## License

MIT — see [LICENSE](./LICENSE).
