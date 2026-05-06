################################################################################
# Public DNS + Shared TLS (Cloudflare zone, AWS ACM cert)
#
# Responsibilities:
#   1. ACM certificate in us-east-1 covering apex + www
#      (+ optional docs + optional admin + optional api). The cert keeps
#      the `www` SAN so the (now externally-managed) marketing site can
#      keep using it without forcing a cert rotation; the apex/www DNS
#      records and the www→apex redirect distribution moved out of this
#      module on 2026-05-06 when apps/www was extracted to its own repo
#      (thinkwork-ai/thinkworkwebsite).
#   2. Cloudflare DNS records for ACM DNS validation.
#   3. Optional docs.<domain> CNAME → docs CloudFront distribution.
#   4. Optional admin.<domain> CNAME → admin CloudFront distribution.
#   5. Optional api.<domain> custom domain → API Gateway v2 regional domain.
#
# Cloudflare records MUST be DNS-only (grey cloud). CloudFront terminates TLS
# with the ACM cert and needs the real Host header.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

locals {
  apex    = var.domain
  www     = "www.${var.domain}"
  docs    = "docs.${var.domain}"
  admin   = "admin.${var.domain}"
  api     = "api.${var.domain}"
  name_id = replace(var.domain, ".", "-")

  # ACM SANs: always include www, conditionally include docs, admin, api.
  # Gated on plain bool vars (not on CloudFront/API Gateway outputs) to keep
  # the dependency graph acyclic — distributions / custom domain names
  # depend on the cert, so the cert mustn't depend on those outputs.
  cert_sans = concat(
    [local.www],
    var.include_docs ? [local.docs] : [],
    var.include_admin ? [local.admin] : [],
    var.include_api ? [local.api] : [],
  )

  # CNAME records can only be created when we have the target domain to
  # point at. Those inputs come after the cert is done, so they don't
  # participate in the cert's dependency graph.
  create_docs_record  = var.include_docs && var.docs_cloudfront_domain_name != ""
  create_admin_record = var.include_admin && var.admin_cloudfront_domain_name != ""
  create_api_record   = var.include_api && var.api_gateway_id != ""
}

################################################################################
# ACM certificate (us-east-1, covers apex + www [+ docs])
################################################################################

resource "aws_acm_certificate" "www" {
  domain_name               = local.apex
  subject_alternative_names = local.cert_sans
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-${local.name_id}"
  }
}

resource "cloudflare_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.www.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
      type  = dvo.resource_record_type
    }
  }

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(each.value.name, ".")
  content = trimsuffix(each.value.value, ".")
  type    = each.value.type
  ttl     = 60
  proxied = false
  comment = "ACM DNS validation for ${each.key}"
}

resource "aws_acm_certificate_validation" "www" {
  certificate_arn         = aws_acm_certificate.www.arn
  validation_record_fqdns = [for r in cloudflare_record.acm_validation : r.hostname]
}

################################################################################
# docs.<domain> → docs CloudFront distribution (optional)
#
# Created only when the greenfield stack wires docs_cloudfront_domain_name.
# The docs CloudFront alias picks up the same ACM cert via certificate_arn
# on the thinkwork module's docs_site.
################################################################################

resource "cloudflare_record" "docs" {
  count = local.create_docs_record ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = local.docs
  content = var.docs_cloudfront_domain_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${var.stage} docs → CloudFront"
}

################################################################################
# admin.<domain> → admin CloudFront distribution (optional)
################################################################################

resource "cloudflare_record" "admin" {
  count = local.create_admin_record ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = local.admin
  content = var.admin_cloudfront_domain_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${var.stage} admin → CloudFront"
}

################################################################################
# api.<domain> → HTTP API Gateway (optional)
#
# API Gateway v2 HTTP APIs support regional custom domains. The cert lives in
# the same region as the API (us-east-1 here) and the domain name maps the
# target stage under the root base path ("") so routes defined on the API
# (/api/stripe/webhook, /graphql, etc.) are reachable at the vanity domain.
#
# Cloudflare must stay DNS-only (proxied=false). API Gateway presents the
# ACM cert directly; a proxied CNAME would mess with the TLS handshake.
################################################################################

resource "aws_apigatewayv2_domain_name" "api" {
  count = var.include_api ? 1 : 0

  domain_name = local.api

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.www.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = {
    Name  = "thinkwork-${var.stage}-api-custom-domain"
    Stage = var.stage
  }
}

resource "aws_apigatewayv2_api_mapping" "api" {
  count = local.create_api_record ? 1 : 0

  api_id      = var.api_gateway_id
  domain_name = aws_apigatewayv2_domain_name.api[0].id
  stage       = var.api_gateway_stage_name
}

resource "cloudflare_record" "api" {
  count = local.create_api_record ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = local.api
  content = aws_apigatewayv2_domain_name.api[0].domain_name_configuration[0].target_domain_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${var.stage} api → API Gateway v2 regional domain"
}
