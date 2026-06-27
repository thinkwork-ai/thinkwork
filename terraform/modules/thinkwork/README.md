# `thinkwork` — Composite Root Module

Wires the three tiers (foundation → data → app) together with sensible defaults.
Published to the Terraform Registry as `thinkwork-ai/thinkwork/aws`.

For advanced composition, use the sub-modules directly:

```hcl
source = "thinkwork-ai/thinkwork/aws//modules/foundation/vpc"
```

## Breaking change — required provider alias

**As of the customer-domain namespace feature**, this module unconditionally declares:

```hcl
configuration_aliases = [aws.us_east_1]
```

Every root module that calls `thinkwork-ai/thinkwork/aws` **must** declare the aliased
provider and pass it through, even when `customer_domain` is left empty:

```hcl
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

module "thinkwork" {
  source = "thinkwork-ai/thinkwork/aws"

  providers = {
    aws.us_east_1 = aws.us_east_1
  }

  # ... other inputs ...
}
```

**Rationale:** CloudFront ACM certificates must be created in `us-east-1` regardless
of the deployment region. Because `configuration_aliases` is declared unconditionally,
Terraform validates the alias at `init`/`plan` time for all callers — not only those
who set `customer_domain`.

## Usage

See `terraform/examples/greenfield/` for a full working example.

## Inputs

See `variables.tf` for the full list with descriptions and defaults. Key optional
feature flags:

| Variable                         | Default | Purpose                                                            |
| -------------------------------- | ------- | ------------------------------------------------------------------ |
| `customer_domain`                | `""`    | Customer-namespace domain (e.g. `tei.thinkwork.ai`). Empty = skip. |
| `customer_domain_delegated`      | `false` | Phase-two gate — flip once NS delegation resolves.                 |
| `customer_domain_legacy_retired` | `false` | Retirement gate — removes legacy Cognito callbacks after cutover.  |
| `enable_hindsight`               | `true`  | Provisions Hindsight canonical user and Space memory.              |
| `enable_cognee`                  | `false` | Provisions optional Cognee Brain ontology/graph infrastructure.    |
| `www_domain`                     | `""`    | Public website apex domain. Empty = CloudFront URL only.           |

## Outputs

See `outputs.tf` for the full list. Key customer-domain outputs:

| Output                            | Purpose                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| `customer_domain_name_servers`    | Route53 NS records to publish via `claim --set-targets` (phase two).  |
| `customer_domain_zone_id`         | Route53 hosted zone ID for the customer domain.                       |
| `customer_domain_certificate_arn` | Validated ACM cert ARN (populated after `customer_domain_delegated`). |
