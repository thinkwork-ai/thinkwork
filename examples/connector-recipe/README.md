# Thinkwork Connector Recipe — Example

This directory is a template for building a custom connector: an AWS Lambda
that receives webhooks from an external service and routes messages into
Thinkwork threads. It pairs with a skill that sends replies back.

## Structure

```
connector-recipe/
  handler/
    main.py            # Lambda entry point — signature verification + routing
    auth.py            # HMAC-SHA256 webhook signature verification
    thread.py          # Thinkwork API helpers (create/resume thread)
    requirements.txt   # Python stdlib only, no pip install needed
  skill/
    SKILL.md           # Agent skill for sending replies back to the external service
  terraform/
    main.tf            # Lambda + API Gateway v2 infrastructure
    variables.tf       # Input variables
    outputs.tf         # Outputs (webhook URL)
  test.mjs             # Validation script
  package.json
```

## How It Works

1. External service posts a webhook to the API Gateway endpoint.
2. `handler/auth.py` verifies the HMAC-SHA256 signature to authenticate the request.
3. `handler/main.py` parses the payload and calls `create_or_resume_thread` in `handler/thread.py`.
4. The Thinkwork inbound API routes the message to the configured agent.
5. The agent uses the `send_reply` tool from `skill/SKILL.md` to deliver the response
   back to the external service.

## Deployment

### 1. Configure variables

Create a `terraform/terraform.tfvars` file (do not commit secrets):

```hcl
thinkwork_api_url      = "https://api.thinkwork.ai"
thinkwork_api_key      = "tw_..."
webhook_signing_secret = "whsec_..."
connector_id           = "my-slack-connector"
default_agent_id       = "agt_abc123"
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

| File               | What to change                                                          |
| ------------------ | ----------------------------------------------------------------------- |
| `handler/main.py`  | Adapt payload parsing to match your external service's webhook format  |
| `handler/auth.py`  | Replace HMAC scheme if your service uses a different signing algorithm  |
| `handler/thread.py`| Extend with metadata fields your agent needs                           |
| `skill/SKILL.md`   | Update tool descriptions and usage guidelines for your use case         |
| `terraform/main.tf`| Add VPC config, reserved concurrency, or DLQ as needed                 |

## Validation

```bash
node test.mjs
```

Checks that all required handler, skill, and Terraform files are present and
that `skill/SKILL.md` has valid YAML frontmatter.
