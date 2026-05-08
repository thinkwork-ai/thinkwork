################################################################################
# Public Website DNS + TLS (Cloudflare zone, AWS ACM cert, www→apex 301)
#
# Responsibilities:
#   1. ACM certificate in us-east-1 covering apex + www
#      (+ optional docs + optional admin).
#   2. Cloudflare DNS records for ACM DNS validation.
#   3. Apex CNAME in Cloudflare → primary CloudFront distribution (DNS-only).
#   4. Second CloudFront distribution fronting an S3 website-redirect bucket
#      that 301s www.<domain> → https://<domain>, plus its Cloudflare CNAME.
#   5. Optional docs.<domain> CNAME → docs CloudFront distribution.
#   6. Optional admin.<domain> CNAME → admin CloudFront distribution.
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
  apex     = var.domain
  www      = "www.${var.domain}"
  docs     = "docs.${var.domain}"
  admin    = "admin.${var.domain}"
  computer = "computer.${var.domain}"
  api      = "api.${var.domain}"
  name_id  = replace(var.domain, ".", "-")

  # ACM SANs: always include www, conditionally include docs, admin, computer, api.
  # Gated on plain bool vars (not on CloudFront/API Gateway outputs) to keep
  # the dependency graph acyclic — distributions / custom domain names
  # depend on the cert, so the cert mustn't depend on those outputs.
  cert_sans = concat(
    [local.www],
    var.include_docs ? [local.docs] : [],
    var.include_admin ? [local.admin] : [],
    var.include_computer ? [local.computer] : [],
    var.include_api ? [local.api] : [],
  )

  # CNAME records can only be created when we have the target domain to
  # point at. Those inputs come after the cert is done, so they don't
  # participate in the cert's dependency graph.
  create_docs_record     = var.include_docs && var.docs_cloudfront_domain_name != ""
  create_admin_record    = var.include_admin && var.admin_cloudfront_domain_name != ""
  create_computer_record = var.include_computer && var.computer_cloudfront_domain_name != ""
  create_api_record      = var.include_api && var.api_gateway_id != ""
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

  # When the cert SAN list changes (adding admin/computer/api/etc.), ACM may
  # reissue with new validation tokens. With create_before_destroy on the cert,
  # Terraform creates the new cert + validation records before destroying the
  # old ones — and the Cloudflare provider rejects with "expected DNS record to
  # not already be present but already exists" when names collide. allow_overwrite
  # tells the provider to take ownership of an existing record by name instead
  # of failing. Safe here because the validation records are fully managed by
  # this resource — anything else writing _acm-challenge records on this zone
  # would already be a conflict we'd want to overwrite.
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "www" {
  certificate_arn         = aws_acm_certificate.www.arn
  validation_record_fqdns = [for r in cloudflare_record.acm_validation : r.hostname]
}

################################################################################
# Apex DNS → primary CloudFront distribution
#
# Cloudflare flattens apex CNAMEs automatically. proxied=false is required so
# CloudFront sees the real Host header and the ACM cert matches.
################################################################################

resource "cloudflare_record" "apex" {
  zone_id = var.cloudflare_zone_id
  name    = local.apex
  content = var.cloudfront_domain_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${var.stage} apex → CloudFront (www)"
}

################################################################################
# www.<domain> → apex 301 redirect
#
# Uses an S3 website-redirect bucket (website endpoint, not REST). Fronted by
# its own CloudFront distribution with the www alias and the same ACM cert.
################################################################################

resource "aws_s3_bucket" "www_redirect" {
  bucket = "thinkwork-${var.stage}-www-redirect"

  tags = {
    Name = "thinkwork-${var.stage}-www-redirect"
  }
}

resource "aws_s3_bucket_public_access_block" "www_redirect" {
  bucket = aws_s3_bucket.www_redirect.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_website_configuration" "www_redirect" {
  bucket = aws_s3_bucket.www_redirect.id

  redirect_all_requests_to {
    host_name = local.apex
    protocol  = "https"
  }
}

resource "aws_cloudfront_distribution" "www_redirect" {
  enabled         = true
  aliases         = [local.www]
  price_class     = "PriceClass_100"
  is_ipv6_enabled = true
  comment         = "thinkwork-${var.stage}-www-redirect → ${local.apex}"

  origin {
    domain_name = aws_s3_bucket_website_configuration.www_redirect.website_endpoint
    origin_id   = "s3-website-${aws_s3_bucket.www_redirect.id}"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-website-${aws_s3_bucket.www_redirect.id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.www.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name = "thinkwork-${var.stage}-www-redirect"
  }
}

resource "cloudflare_record" "www_redirect" {
  zone_id = var.cloudflare_zone_id
  name    = local.www
  content = aws_cloudfront_distribution.www_redirect.domain_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${var.stage} www → redirect distribution"
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
# computer.<domain> → computer CloudFront distribution (optional)
################################################################################

resource "cloudflare_record" "computer" {
  count = local.create_computer_record ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = local.computer
  content = var.computer_cloudfront_domain_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${var.stage} computer → CloudFront"
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
