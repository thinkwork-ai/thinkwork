################################################################################
# Customer Domain — App Module (<name>.thinkwork.ai)
#
# Owns the customer-account half of the customer-domain namespace: a Route53
# hosted zone for the NS-delegated subdomain plus, once delegation has
# resolved, the ACM certificate and web alias records that put the end-user
# app on https://<name>.thinkwork.ai.
#
# Responsibilities:
#   1. Route53 hosted zone for the customer domain whenever one is configured
#      (pre-delegation: the zone exists but nothing resolves to it). The four
#      name servers are surfaced as outputs so the shared claim tool can run
#      its phase-two `claim --set-targets <ns...>` against the Cloudflare
#      apex zone.
#   2. CAA record `0 issue "amazon.com"` published with the zone, so the
#      delegated subtree can only ever obtain Amazon-issued (ACM)
#      certificates.
#   3. Gated on customer_domain_delegated: ACM certificate in us-east-1
#      (CloudFront requires us-east-1 certs; provided via the aws.us_east_1
#      provider alias), DNS validation records written into this module's
#      own zone (single apply once delegation resolves), and a validation
#      waiter with an explicit fail-fast timeout — a pre-delegation gate
#      flip must fail in minutes, not hang a CodeBuild run for hours.
#   4. Gated on customer_domain_delegated: A/AAAA alias records pointing the
#      customer domain at the end-user app CloudFront distribution.
#
# Cycle avoidance: every resource count gates on plain bool/string vars,
# never on downstream CloudFront outputs — the app distribution consumes
# this module's certificate, so the certificate (and everything its count
# depends on) must not depend on distribution outputs. Only the alias
# records' *attributes* reference the distribution domain, which keeps the
# resource graph acyclic: cert → distribution → alias records.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"

      # CloudFront only accepts certificates from us-east-1. Callers must
      # pass an aliased us-east-1 provider:
      #   providers = { aws.us_east_1 = aws.us_east_1 }
      configuration_aliases = [aws.us_east_1]
    }
  }
}

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "customer_domain" {
  description = "Customer domain to host in this account (e.g. tei.thinkwork.ai). Leave empty to create nothing."
  type        = string
  default     = ""
}

variable "customer_domain_delegated" {
  description = "Set true once the parent zone's NS records point at this zone (claim tool phase two). Gates the ACM certificate, its validation, and the web alias records."
  type        = bool
  default     = false
}

variable "app_distribution_domain_name" {
  description = "CloudFront distribution domain name of the end-user app (e.g. dxxxx.cloudfront.net). Target of the A/AAAA alias records. May be unknown at plan time — it never drives a resource count."
  type        = string
  default     = ""
}

locals {
  zone_enabled = var.customer_domain != ""
  cert_enabled = local.zone_enabled && var.customer_domain_delegated

  name_id = replace(var.customer_domain, ".", "-")

  # Universal hosted zone ID for CloudFront distributions — a documented AWS
  # constant, identical for every distribution in every account.
  cloudfront_hosted_zone_id = "Z2FDTNDATAQYW2"
}

################################################################################
# Hosted zone + CAA (created with the zone, pre-delegation)
################################################################################

resource "aws_route53_zone" "customer" {
  count = local.zone_enabled ? 1 : 0

  name    = var.customer_domain
  comment = "thinkwork-${var.stage} customer domain"

  tags = {
    Name = "thinkwork-${var.stage}-customer-domain-zone"
  }
}

# Published at zone creation so that from the instant delegation resolves,
# only Amazon's CAs may issue certificates for the delegated subtree.
# Per ACM docs, `issue "amazon.com"` authorizes all four Amazon CA domains.
resource "aws_route53_record" "caa" {
  count = local.zone_enabled ? 1 : 0

  zone_id = aws_route53_zone.customer[0].zone_id
  name    = var.customer_domain
  type    = "CAA"
  ttl     = 300
  records = ["0 issue \"amazon.com\""]
}

################################################################################
# ACM certificate (us-east-1) + DNS validation in our own zone
#
# Validation records live in this module's zone, so once the NS hop resolves
# the certificate validates in the same apply that creates it (no second
# out-of-band step beyond flipping customer_domain_delegated).
################################################################################

resource "aws_acm_certificate" "customer" {
  count    = local.cert_enabled ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.customer_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-${local.name_id}"
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in(local.cert_enabled ? aws_acm_certificate.customer[0].domain_validation_options : []) :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.customer[0].zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "customer" {
  count    = local.cert_enabled ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.customer[0].arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]

  # Fail fast (KTD3): the default validation timeout is far too generous for
  # a gate that should only ever be flipped after delegation resolved. If
  # validation hasn't succeeded in 30 minutes the NS hop almost certainly
  # hasn't landed — fail the apply instead of hanging the deploy runner.
  timeouts {
    create = "30m"
  }
}

################################################################################
# Web alias records → end-user app CloudFront distribution
#
# Counts gate on the same plain bool as the certificate (never on the
# distribution output, which is unknown at plan time on greenfield).
################################################################################

resource "aws_route53_record" "app_alias_a" {
  count = local.cert_enabled ? 1 : 0

  zone_id = aws_route53_zone.customer[0].zone_id
  name    = var.customer_domain
  type    = "A"

  alias {
    name                   = var.app_distribution_domain_name
    zone_id                = local.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app_alias_aaaa" {
  count = local.cert_enabled ? 1 : 0

  zone_id = aws_route53_zone.customer[0].zone_id
  name    = var.customer_domain
  type    = "AAAA"

  alias {
    name                   = var.app_distribution_domain_name
    zone_id                = local.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

################################################################################
# Outputs
################################################################################

output "zone_id" {
  description = "Route53 hosted zone ID for the customer domain (empty when no domain is configured)"
  value       = local.zone_enabled ? aws_route53_zone.customer[0].zone_id : ""
}

output "name_servers" {
  description = "The four Route53 name servers for the customer zone — phase-two input for the claim tool's `claim --set-targets` (empty when no domain is configured)"
  value       = local.zone_enabled ? aws_route53_zone.customer[0].name_servers : []
}

output "certificate_arn" {
  description = "Validated ACM certificate ARN for the customer domain (us-east-1; empty until customer_domain_delegated is true and validation succeeds)"
  value       = local.cert_enabled ? aws_acm_certificate_validation.customer[0].certificate_arn : ""
}
