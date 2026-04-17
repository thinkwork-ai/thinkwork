# thinkwork-cli

Deploy and manage Thinkwork AI agent stacks on AWS.

## Install

```bash
# Homebrew (macOS / Linux) — auto-taps thinkwork-ai/tap on first install
brew install thinkwork-ai/tap/thinkwork

# npm
npm install -g thinkwork-cli
```

Or run without installing:

```bash
npx thinkwork-cli --help
```

## Quick Start

### Deploy a new stack

```bash
# 1. Authenticate with AWS (profile picker, --sso, or --keys)
thinkwork login

# 2. Check prerequisites
thinkwork doctor -s dev

# 3. Initialize a new environment (interactive)
thinkwork init -s dev

# 4. Review the plan
thinkwork plan -s dev

# 5. Deploy (~5 min)
thinkwork deploy -s dev

# 6. Seed workspace files + skill catalog
thinkwork bootstrap -s dev

# 7. Show what was deployed
thinkwork outputs -s dev
```

### Sign in to the deployed stack

```bash
# 8. Sign in to the Cognito user pool (opens browser; supports Google OAuth)
thinkwork login --stage dev

# 9. Verify identity + default tenant
thinkwork me

# 10. (CI only) non-interactive session with the api_auth_secret
thinkwork login --stage prod --api-key "$THINKWORK_API_KEY" --tenant acme
```

After step 8, API-backed commands (`thinkwork thread list`, `thinkwork agent create`, etc.) resolve auth + tenant automatically from the stored session. The Cognito id-token refreshes in the background.

No repo clone required — `thinkwork init` scaffolds all Terraform modules from the npm package.

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `thinkwork login` | Configure AWS credentials (access keys or `--sso`) |
| `thinkwork login --stage <s>` | Sign in to a deployed stack via Cognito (OAuth; Google supported). Caches tokens in `~/.thinkwork/config.json` |
| `thinkwork login --stage <s> --api-key <secret>` | Non-interactive CI path; stores the api_auth_secret as the session |
| `thinkwork logout [--stage <s> \| --all]` | Forget stored sessions |
| `thinkwork me [--stage <s>]` | Print who you're signed in as on a stage (verifies via a live `me` query) |
| `thinkwork init -s <stage>` | Initialize a new environment — generates terraform.tfvars, scaffolds Terraform modules, runs `terraform init` |
| `thinkwork doctor -s <stage>` | Check prerequisites (AWS CLI, Terraform, credentials, Bedrock access) |

### Deploy

| Command | Description |
|---------|-------------|
| `thinkwork plan -s <stage>` | Preview infrastructure changes |
| `thinkwork deploy -s <stage>` | Deploy infrastructure (terraform apply) |
| `thinkwork bootstrap -s <stage>` | Seed workspace defaults, skill catalog, and per-tenant files |
| `thinkwork destroy -s <stage>` | Tear down infrastructure |

### Manage

| Command | Description |
|---------|-------------|
| `thinkwork status` | Discover all deployed environments in AWS (clickable URLs) |
| `thinkwork status -s <stage>` | Detailed view for one environment |
| `thinkwork outputs -s <stage>` | Show deployment outputs (API URL, Cognito IDs, etc.) |
| `thinkwork config list` | List all initialized environments |
| `thinkwork config list -s <stage>` | Show full config for an environment (secrets masked) |
| `thinkwork config get <key> -s <stage>` | Read a configuration value |
| `thinkwork config set <key> <value> -s <stage>` | Update a configuration value |

## Options

```
-s, --stage <name>      Deployment stage (required for most commands)
-t, --tenant <slug>     Tenant (workspace) slug. Falls back to the cached default.
-p, --profile <name>    AWS profile to use
-c, --component <tier>  Component tier: foundation, data, app, or all (default: all)
-y, --yes               Skip confirmation prompts (for CI)
--json                  Emit machine-readable JSON on stdout (stderr for logs)
--defaults              Skip interactive prompts in init (use all defaults)
-v, --version           Print CLI version
-h, --help              Show help
```

The CLI has two modes for every API-backed command:

- **Flag-driven** — every field can be passed as a flag for scripting / agents.
  Missing required flags in a non-TTY context exit 1 with a clear error.
- **Interactive walkthrough** — when running in a terminal, missing fields are
  prompted via arrow-key pickers. `Ctrl+C` cancels cleanly.

Any flag accepted by a command is also inferrable from env vars:
`THINKWORK_STAGE`, `THINKWORK_TENANT`, `THINKWORK_API_KEY` (for CI).

## Roadmap

The commands below are **scaffolded** in Phase 0 (help text + argument parsing
ships now, so `thinkwork --help` shows the full surface area) and fill in
phase-by-phase. Running a scaffolded command prints a "not yet implemented"
message and exits with code 2.

| Phase | Domain | Commands |
|-------|--------|----------|
| **0 (now)** | Foundation | `login` (Cognito + AWS), `logout`, `me`, `--json`, GraphQL client, codegen, shared helpers |
| 1 | Work & approvals | `thread`, `message`, `label`, `inbox` |
| 2 | Agents & workspace | `agent`, `template`, `tenant`, `member`, `team`, `kb` |
| 3 | Automation & integrations | `routine`, `scheduled-job`, `turn`, `wakeup`, `webhook`, `connector`, `skill` |
| 4 | Memory & artifacts | `memory`, `recipe`, `artifact` |
| 5 | Observability & spend | `cost`, `budget`, `performance`, `trace`, `dashboard` |

Each phase ships as one PR. Mid-phase stubs keep `thinkwork --help` complete
so the full surface is always discoverable; individual commands flip from
stub to real implementation as their phase lands. Run any
`thinkwork <cmd> --help` today to see the planned flags + examples.

## Interactive Init

`thinkwork init` walks you through all configuration options:

- **AWS Region** — where to deploy (default: us-east-1)
- **Database engine** — `aurora-serverless` (production) or `rds-postgres` (dev, cheaper)
- **Hindsight add-on** — optional y/N (managed AgentCore memory with automatic per-turn retention is always on; Hindsight adds ECS Fargate semantic + entity-graph retrieval alongside it)
- **Google OAuth** — optional social login for Cognito
- **Admin UI URL** — callback URL for the admin dashboard
- **Mobile app scheme** — deep link scheme for the mobile app
- **Secrets** — DB password and API auth secret are auto-generated

For CI, use `--defaults` to skip prompts:

```bash
thinkwork init -s staging --defaults
```

## Environment Registry

All initialized environments are saved to `~/.thinkwork/environments/<stage>/config.json`. This means:

- **No `cd` required** — all commands auto-resolve the terraform directory
- **List all stages** — `thinkwork config list` shows a table of all environments
- **Inspect any stage** — `thinkwork config list -s dev` shows full config

## Examples

### Check all environments

```bash
thinkwork status
```

```
  ⬡ dev
  ─────────────────────────────────────────
  Source:          AWS + local config
  Region:          us-east-1
  Account:         123456789012
  Lambda fns:      42
  AgentCore:       Active
  Memory:          managed (always on)
  Hindsight:       healthy
  ...
```

URLs are clickable in supported terminals (iTerm2, Windows Terminal, VS Code, etc.).

### Enable the Hindsight memory add-on

Managed AgentCore memory is always on. To also enable Hindsight (ECS Fargate
service for semantic + entity-graph retrieval) alongside it:

```bash
thinkwork config set enable-hindsight true -s dev --apply
```

### Deploy a specific tier

```bash
thinkwork deploy -s dev -c app
```

### Use with AWS SSO

```bash
thinkwork login --sso --profile my-org
thinkwork deploy -s dev --profile my-org
```

### CI/CD (non-interactive)

```bash
# Deploy side — uses AWS credentials from env / IAM role.
thinkwork init -s prod --defaults
thinkwork deploy -s prod -y
thinkwork bootstrap -s prod

# API side — store the api_auth_secret as an api-key session and invoke
# commands without a browser / TTY.
thinkwork login --stage prod --api-key "$THINKWORK_API_KEY" --tenant "$THINKWORK_TENANT"
thinkwork thread list --status IN_PROGRESS --json | jq '.[].id'
```

### Pipe to jq

Every API-backed command accepts `--json` for machine-readable stdout. Warnings, spinners, and errors always go to stderr, so piping stays clean:

```bash
thinkwork me --json | jq .tenantSlug
thinkwork agent list --status OFFLINE --json | jq '.[].name'
thinkwork cost summary --from 2026-04-01 --json | jq .totalUsd
```

### Forget a stored session

```bash
thinkwork logout --stage dev      # one stage
thinkwork logout --all            # every stage
thinkwork logout                  # interactive picker
```

## Prerequisites

- Node.js >= 20
- [AWS CLI](https://aws.amazon.com/cli/) v2
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS account with Bedrock model access enabled

## What Gets Deployed

Thinkwork provisions a complete AI agent stack (~250 AWS resources):

- **Compute**: Lambda functions (39 handlers), AgentCore container (Lambda + ECR)
- **Database**: Aurora Serverless PostgreSQL with pgvector
- **Auth**: Cognito user pool (admin + mobile clients)
- **API**: API Gateway (REST + GraphQL), AppSync (WebSocket subscriptions)
- **Storage**: S3 (workspace files, skills, knowledge bases)
- **Memory**: Managed (built-in) or Hindsight (ECS Fargate with semantic + BM25 + entity graph retrieval)

## License

MIT
