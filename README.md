# Thinkwork

**Production-grade agent platform for teams that already live on AWS.**

Thinkwork is open infrastructure for AI work. Threads run the work, controls keep it safe, managed and connected agents plug into the same system, and the whole thing drops into your existing AWS account via Terraform.

If you're not on AWS, this isn't the right tool for you — and that's the point. No Kubernetes, no third-party SaaS, no tire-kicker mode.

## Status

🚧 **Pre-release.** v0.1.0 is in active migration from the closed-source maniflow codebase. See [PRD-47 in the maniflow repo](https://github.com/maniflow-ai/maniflow/blob/main/prds/prd-47-thinkwork-oss-cutover.md) for the full migration plan and the eleven-phase rollout. Watch this repo for the v0.1.0 release.

## What ships in v1

- **Six product modules:** Agents, Threads, Connectors, Automations, Control, Knowledge
- **Two clients:** an admin/operator web app (`apps/hive`) and a mobile client (`apps/mobile`, Expo)
- **A real CLI** (`@thinkwork/cli`) for `init`, `deploy`, `doctor`, agent invoke, and skill publishing
- **Three connectors at launch:** Slack, GitHub, Google Workspace
- **Agentic Tasks** and **Question Cards** for structured task intake and execution
- **Knowledge Bases** backed by Bedrock for document RAG
- **Agent Templates** for fleet-wide configuration
- **Terraform Registry modules** at `thinkwork-ai/thinkwork/aws` — drops into your existing AWS Landing Zone with BYO-everywhere support

## What's not in v1

Knowledge Graph + Ontology Studio, AutoResearch, the eval UI, cost tracking, the places service, and a web end-user client are all on the roadmap but not in v0.1.0. We ship things only after they're load-bearing in production. See the docs roadmap page once docs ship.

## Quick start (when v0.1.0 lands)

```bash
npx @thinkwork/cli init my-thinkwork-stack
cd my-thinkwork-stack
terraform init
terraform apply
thinkwork doctor
thinkwork agents create my-first-agent
thinkwork agents invoke my-first-agent "Hello"
```

## Repo layout

```
thinkwork/
  apps/        # runnable products: hive (admin web), mobile (Expo), cli
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
