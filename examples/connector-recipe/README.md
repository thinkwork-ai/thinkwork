# Thinkwork Connector Recipe — Example

This directory is a template for building a custom connector: an AWS Lambda
or poller that receives provider activity, authenticates the provider boundary,
normalizes the payload, and hands work to ThinkWork. Modern connector work should
target a Computer first; managed Agents and routines are delegated workers or
advanced direct targets.

## Structure

```
connector-recipe/
  handler/
    main.py            # Lambda entry point — signature verification + routing
    auth.py            # HMAC-SHA256 webhook signature verification
    thread.py          # ThinkWork API helpers (create/resume visible work)
    requirements.txt   # Python stdlib only, no pip install needed
  skill/
    SKILL.md           # Optional tool guidance for provider writeback
  terraform/
    main.tf            # Lambda + API Gateway v2 infrastructure
    variables.tf       # Input variables
    outputs.tf         # Outputs (webhook URL)
  test.mjs             # Validation script
  package.json
```

## How It Works

1. External service posts a webhook to the API Gateway endpoint, or a poller finds a provider item.
2. `handler/auth.py` verifies the HMAC-SHA256 signature to authenticate the request.
3. `handler/main.py` parses the payload and calls `create_or_resume_thread` in `handler/thread.py`.
4. The ThinkWork inbound API records provenance and hands work to the configured Computer.
5. The Computer handles the work or delegates to a managed Agent or routine.
6. Provider writeback uses tenant credentials, not tokens exposed to the worker.

## Deployment

### 1. Configure variables

Create a `terraform/terraform.tfvars` file (do not commit secrets):

```hcl
thinkwork_api_url      = "https://api.thinkwork.ai"
thinkwork_api_key      = "tw_..."
webhook_signing_secret = "whsec_..."
connector_id           = "my-slack-connector"
target_computer_id     = "computer_abc123"
stage                  = "dev"
```

### 2. Deploy

```bash
cd terraform
terraform init
terraform apply
```

### 3. Register the webhook URL

After `terraform apply`, note the `webhook_url` output and register it as the
webhook destination in your external service's settings panel.

### 4. Upload the skill

Upload `skill/SKILL.md` to S3 under `skills/catalog/my-connector/` so AgentCore
can inject it into the agent context.

## Customization

| File                | What to change                                                         |
| ------------------- | ---------------------------------------------------------------------- |
| `handler/main.py`   | Adapt payload parsing to match your external service's webhook format  |
| `handler/auth.py`   | Replace HMAC scheme if your service uses a different signing algorithm |
| `handler/thread.py` | Extend with metadata fields the Computer and thread need               |
| `skill/SKILL.md`    | Update optional provider writeback guidance for your use case          |
| `terraform/main.tf` | Add VPC config, reserved concurrency, or DLQ as needed                 |

## Validation

```bash
node test.mjs
```

Checks that all required handler, skill, and Terraform files are present and
that `skill/SKILL.md` has valid YAML frontmatter.

## Current connector model

This example is intentionally small. For current product guidance, read:

- `docs/src/content/docs/concepts/connectors.mdx`
- `docs/src/content/docs/concepts/connectors/lifecycle.mdx`
- `docs/src/content/docs/guides/connectors.mdx`

Do not copy older default-agent patterns into new connector work. Use a stable
external reference, idempotent claim behavior, tenant credentials, Computer
handoff, and explicit provider writeback.
