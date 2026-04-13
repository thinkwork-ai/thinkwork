################################################################################
# Public Website DNS + TLS (Cloudflare zone, AWS ACM cert, www→apex 301)
#
# Responsibilities:
#   1. ACM certificate in us-east-1 covering apex + www (+ optional docs).
#   2. Cloudflare DNS records for ACM DNS validation.
#   3. Apex CNAME in Cloudflare → primary CloudFront distribution (DNS-only).
#   4. Second CloudFront distribution fronting an S3 website-redirect bucket
#      that 301s www.<domain> → https://<domain>, plus its Cloudflare CNAME.
#   5. Optional docs.<domain> CNAME → docs CloudFront distribution when
#      docs_cloudfront_domain_name is set.
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
  apex         = var.domain
  www          = "www.${var.domain}"
  docs         = "docs.${var.domain}"
  docs_enabled = var.docs_cloudfront_domain_name != ""
  name_id      = replace(var.domain, ".", "-")

  # ACM SANs: always include www, conditionally include docs.
  cert_sans = local.docs_enabled ? [local.www, local.docs] : [local.www]
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
  count = local.docs_enabled ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = local.docs
  content = var.docs_cloudfront_domain_name
  type    = "CNAME"
  ttl     = 300
  proxied = false
  comment = "thinkwork-${var.stage} docs → CloudFront"
}
