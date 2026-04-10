# @thinkwork/cli

Deploy and manage Thinkwork AI agent stacks on AWS.

## Install

```bash
npm install -g @thinkwork/cli
```

Or run without installing:

```bash
npx @thinkwork/cli --help
```

## Quick Start

```bash
# 1. Authenticate with AWS
thinkwork login

# 2. Check prerequisites
thinkwork doctor -s dev

# 3. Initialize a new environment
thinkwork init -s dev

# 4. Review the plan
thinkwork plan -s dev

# 5. Deploy
thinkwork deploy -s dev

# 6. Seed workspace files + skill catalog
thinkwork bootstrap -s dev
```

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `thinkwork login` | Configure AWS credentials (access keys or SSO) |
| `thinkwork init -s <stage>` | Initialize a new environment (generates tfvars, runs terraform init) |
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
| `thinkwork outputs -s <stage>` | Show deployment outputs (API URL, Cognito IDs, etc.) |
| `thinkwork config get <key> -s <stage>` | Read a configuration value |
| `thinkwork config set <key> <value> -s <stage>` | Update a configuration value |

## Options

```
-s, --stage <name>      Deployment stage (required for most commands)
-p, --profile <name>    AWS profile to use
-c, --component <tier>  Component tier: foundation, data, app, or all (default: all)
-y, --yes               Skip confirmation prompts (for CI)
-v, --version           Print CLI version
-h, --help              Show help
```

## Examples

### Switch memory engine

```bash
# Switch from managed to Hindsight memory
thinkwork config set memory-engine hindsight -s dev --apply
```

### Deploy a specific tier

```bash
# Only deploy the app tier (Lambda functions, API Gateway)
thinkwork deploy -s dev -c app
```

### Use with AWS SSO

```bash
thinkwork login --sso --profile my-org
thinkwork deploy -s dev --profile my-org
```

### CI/CD (non-interactive)

```bash
thinkwork deploy -s prod -y
```

## Prerequisites

- Node.js >= 20
- [AWS CLI](https://aws.amazon.com/cli/) v2
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS account with Bedrock model access enabled

## What Gets Deployed

Thinkwork provisions a complete AI agent stack:

- **Compute**: Lambda functions (39 handlers), AgentCore container (Lambda + ECR)
- **Database**: Aurora Serverless PostgreSQL with pgvector
- **Auth**: Cognito user pool (admin + mobile clients)
- **API**: API Gateway (REST + GraphQL), AppSync (WebSocket subscriptions)
- **Storage**: S3 (workspace files, skills, knowledge bases)
- **Memory**: Managed (built-in) or Hindsight (ECS Fargate, opt-in)

## License

MIT
