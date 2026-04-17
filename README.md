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

🚧 **Pre-release.** v0.1.0 is in active development. Watch this repo for the release.

## What ships in v1

- **Six product modules:** Agents, Threads, Connectors, Automations, Control, Memory
- **Two clients:** an admin/operator web app (`apps/admin`) and a mobile client (`apps/mobile`, Expo)
- **A real CLI** (`thinkwork-cli`) with two surfaces: **deploy-side** (`login`, `init`, `plan`, `deploy`, `bootstrap`, `destroy`, `doctor`, `status`, `outputs`, `config`, `update`) and **API-side** (`login --stage`, `logout`, `me`, `user`, `mcp`, `tools`, plus a scaffolded roadmap of `thread`, `agent`, `template`, `tenant`, `member`, `team`, `kb`, `routine`, `scheduled-job`, `turn`, `wakeup`, `webhook`, `connector`, `skill`, `memory`, `recipe`, `artifact`, `cost`, `budget`, `performance`, `trace`, `inbox`, `dashboard` — see [apps/cli/README.md#roadmap](./apps/cli/README.md#roadmap))
- **Three connectors at launch:** Slack, GitHub, Google Workspace
- **Agentic Tasks** and **Question Cards** for structured task intake and execution
- **Memory** as the umbrella layer for document knowledge, long-term memory, retrieval context, and portable memory contracts
- **Agent Templates** for fleet-wide configuration
- **Terraform Registry modules** at `thinkwork-ai/thinkwork/aws` — drops into your existing AWS Landing Zone with BYO-everywhere support

## Admin web

<p align="center">
  <img src="./apps/www/public/images/admin/dashboard.png" alt="ThinkWork admin dashboard — agents online, open threads, recent activity, recent threads" width="860" />
</p>

The operator surface. A React SPA at `apps/admin`, authenticated through Cognito and tenant-scoped on every request. Platform operators configure agents and templates, wire up connectors and MCP servers, manage the credential vault, register webhooks, upload knowledge, inspect per-agent memory, and watch activity, cost, and guardrail health — all against the tenant running in their own AWS account. See the [admin docs](https://docs.thinkwork.ai/applications/admin/) for the per-route breakdown.

## Mobile app

<p align="center">
  <img src="./apps/www/public/images/mobile/threads-list.png" alt="Threads tab in the ThinkWork mobile app" width="280" />
  <img src="./apps/www/public/images/mobile/tasks-list.png" alt="Tasks tab in the ThinkWork mobile app" width="280" />
</p>

The end-user surface. An Expo + React Native client at `apps/mobile`, currently shipping on iOS via TestFlight. Users get a unified inbox across chat threads, scheduled automations, emails, and **external tasks** routed in from systems like LastMile — tasks render as native GenUI cards with realtime activity, round-trip edits, and narrow-policy push notifications. The mobile app owns per-user OAuth and MCP tokens; tenant configuration stays on the admin side. See the [mobile docs](https://docs.thinkwork.ai/applications/mobile/) for the full surface.

## What's not in v1

Knowledge Graph + Ontology Studio, AutoResearch, the eval UI, cost tracking, the places service, and a web end-user client are all on the roadmap but not in v0.1.0. We ship things only after they're load-bearing in production. See the docs roadmap page once docs ship.

## Quick start

```bash
npm install -g thinkwork-cli
thinkwork login                    # 1. Pick an AWS profile
thinkwork init -s dev              # 2. Scaffold terraform.tfvars
thinkwork deploy -s dev            # 3. Provision ~260 AWS resources
thinkwork doctor -s dev            # 4. Sanity-check the stack
thinkwork login --stage dev        # 5. Sign in to the Cognito pool (OAuth)
thinkwork me                       # 6. Confirm identity + tenant
```

Six commands, one AWS account, and you own a production-grade agent harness instead of renting a black box. Full walkthrough in the [Getting Started guide](https://docs.thinkwork.ai/getting-started/).

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
