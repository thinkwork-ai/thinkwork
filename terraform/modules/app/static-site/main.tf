################################################################################
# Static Site — App Module
#
# S3 + CloudFront distribution for static web apps (apps/admin, docs site).
# Reusable for any static frontend that needs a CDN + custom domain.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "site_name" {
  description = "Identifier for the site (e.g. admin, docs)"
  type        = string
}

variable "bucket_name" {
  description = "S3 bucket name for the site assets"
  type        = string
  default     = ""
}

variable "custom_domain" {
  description = "Custom domain (e.g. app.thinkwork.ai). Leave empty for CloudFront default."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the custom domain (us-east-1, required for CloudFront)"
  type        = string
  default     = ""
}

variable "is_spa" {
  description = "When true, configure CloudFront for a single-page app: drop the directory-rewrite function and fall back to /index.html with 200 on 403/404 so the client router can handle deep links."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Response-headers policy (optional, plan-012 U3)
#
# Two opt-in forms, both backwards compatible — existing callers
# (computer_site, admin_site, docs_site, www_site) leave both unset and the
# distribution is created with no response-headers policy attached:
#
#   - Pass `response_headers_policy_id` to attach an existing policy by id.
#     Useful if a sibling module already minted the policy and you want to
#     share it across distributions.
#
#   - Pass `inline_response_headers` (an object describing the CSP + other
#     response headers) to have this module mint a fresh policy and attach
#     it. Used by `computer_sandbox_site` to ship the iframe-side CSP
#     (script-src 'self' blob:; connect-src 'none'; frame-ancestors ... etc.)
#     alongside the dedicated sandbox distribution.
#
# Passing both is an error — the inline policy would be unused.
# ---------------------------------------------------------------------------

variable "response_headers_policy_id" {
  description = "ID of an existing aws_cloudfront_response_headers_policy to attach. Mutually exclusive with inline_response_headers."
  type        = string
  default     = ""
}

variable "inline_response_headers" {
  description = "When set, this module mints a new response-headers policy and attaches it. Pass null to skip. Fields: content_security_policy (string), content_type_options_override (bool), strict_transport_security (object: max_age_sec, include_subdomains, preload, override), cors (object: allow_origins, allow_methods, allow_headers, allow_credentials, max_age_sec, origin_override). Mutually exclusive with response_headers_policy_id."
  type = object({
    content_security_policy       = optional(string)
    content_type_options_override = optional(bool, true)
    strict_transport_security = optional(object({
      max_age_sec        = number
      include_subdomains = bool
      preload            = bool
      override           = bool
    }))
    cors = optional(object({
      allow_origins     = list(string)
      allow_methods     = optional(list(string), ["GET", "HEAD", "OPTIONS"])
      allow_headers     = optional(list(string), ["*"])
      allow_credentials = optional(bool, false)
      max_age_sec       = optional(number, 600)
      origin_override   = optional(bool, true)
    }))
  })
  default = null
}

################################################################################
# S3 Bucket
################################################################################

locals {
  bucket_name = var.bucket_name != "" ? var.bucket_name : "thinkwork-${var.stage}-${var.site_name}"

  # Mutually-exclusive validator — surface as an error during plan.
  _conflicting_policy_inputs = var.response_headers_policy_id != "" && var.inline_response_headers != null

  inline_policy_enabled = var.inline_response_headers != null

  # Final policy id wired into the cache behavior. Empty string means no
  # policy (CloudFront default). Terraform's resource attribute treats ""
  # the same as null because we condition on it below.
  effective_response_headers_policy_id = (
    var.response_headers_policy_id != ""
    ? var.response_headers_policy_id
    : (local.inline_policy_enabled
      ? aws_cloudfront_response_headers_policy.inline[0].id
      : ""
    )
  )
}

check "policy_inputs_are_mutually_exclusive" {
  assert {
    condition     = !local._conflicting_policy_inputs
    error_message = "static-site: response_headers_policy_id and inline_response_headers are mutually exclusive."
  }
}

resource "aws_s3_bucket" "site" {
  bucket = local.bucket_name

  tags = {
    Name = "thinkwork-${var.stage}-${var.site_name}"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

################################################################################
# CloudFront Response-Headers Policy (optional, inline-minted variant)
################################################################################

resource "aws_cloudfront_response_headers_policy" "inline" {
  count = local.inline_policy_enabled ? 1 : 0

  name    = "thinkwork-${var.stage}-${var.site_name}-headers"
  comment = "Response-headers policy for thinkwork-${var.stage}-${var.site_name}"

  dynamic "security_headers_config" {
    for_each = var.inline_response_headers.content_security_policy != null || var.inline_response_headers.content_type_options_override != false || var.inline_response_headers.strict_transport_security != null ? [1] : []
    content {
      dynamic "content_security_policy" {
        for_each = var.inline_response_headers.content_security_policy != null ? [1] : []
        content {
          content_security_policy = var.inline_response_headers.content_security_policy
          override                = true
        }
      }

      dynamic "content_type_options" {
        for_each = var.inline_response_headers.content_type_options_override == true ? [1] : []
        content {
          override = true
        }
      }

      dynamic "strict_transport_security" {
        for_each = var.inline_response_headers.strict_transport_security != null ? [1] : []
        content {
          access_control_max_age_sec = var.inline_response_headers.strict_transport_security.max_age_sec
          include_subdomains         = var.inline_response_headers.strict_transport_security.include_subdomains
          preload                    = var.inline_response_headers.strict_transport_security.preload
          override                   = var.inline_response_headers.strict_transport_security.override
        }
      }
    }
  }

  dynamic "cors_config" {
    for_each = var.inline_response_headers.cors != null ? [var.inline_response_headers.cors] : []
    content {
      access_control_allow_credentials = cors_config.value.allow_credentials
      access_control_max_age_sec       = cors_config.value.max_age_sec
      origin_override                  = cors_config.value.origin_override

      access_control_allow_headers {
        items = cors_config.value.allow_headers
      }

      access_control_allow_methods {
        items = cors_config.value.allow_methods
      }

      access_control_allow_origins {
        items = cors_config.value.allow_origins
      }
    }
  }
}

################################################################################
# CloudFront OAC
################################################################################

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "thinkwork-${var.stage}-${var.site_name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

################################################################################
# CloudFront Function — rewrite directory URIs to index.html
#
# S3 with OAC doesn't auto-serve index.html for subdirectory requests.
# /getting-started/ → /getting-started/index.html
#
# Always created (so flipping is_spa on an existing distribution doesn't hit
# CloudFront's "can't delete a function still associated with a distribution"
# error), but the viewer-request association is only wired up for non-SPA
# sites. For SPAs we rely on the 403/404 → /index.html fallback below.
################################################################################

resource "aws_cloudfront_function" "rewrite" {
  name    = "thinkwork-${var.stage}-${var.site_name}-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOF
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri.endsWith('/')) {
        request.uri += 'index.html';
      } else if (!uri.includes('.')) {
        request.uri += '/index.html';
      }
      return request;
    }
  EOF
}

locals {
  # For SPAs, 403/404 from S3 means "not a real asset" — serve index.html with
  # a 200 so the client router can resolve the route. For directory-style
  # static sites, surface a real 404 page.
  error_responses = var.is_spa ? [
    { error_code = 403, response_code = 200, response_page_path = "/index.html" },
    { error_code = 404, response_code = 200, response_page_path = "/index.html" },
    ] : [
    { error_code = 404, response_code = 404, response_page_path = "/404.html" },
    { error_code = 403, response_code = 404, response_page_path = "/404.html" },
  ]
}

################################################################################
# CloudFront Distribution
################################################################################

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = var.custom_domain != "" ? [var.custom_domain] : []
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-${local.bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id           = "s3-${local.bucket_name}"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    response_headers_policy_id = local.effective_response_headers_policy_id != "" ? local.effective_response_headers_policy_id : null

    dynamic "function_association" {
      for_each = var.is_spa ? [] : [1]
      content {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.rewrite.arn
      }
    }

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  dynamic "custom_error_response" {
    for_each = local.error_responses
    content {
      error_code         = custom_error_response.value.error_code
      response_code      = custom_error_response.value.response_code
      response_page_path = custom_error_response.value.response_page_path
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == ""
    acm_certificate_arn            = var.certificate_arn != "" ? var.certificate_arn : null
    ssl_support_method             = var.certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = var.certificate_arn != "" ? "TLSv1.2_2021" : null
  }

  tags = {
    Name = "thinkwork-${var.stage}-${var.site_name}"
  }
}

################################################################################
# S3 Bucket Policy — CloudFront access
################################################################################

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowCloudFrontOAC"
      Effect = "Allow"
      Principal = {
        Service = "cloudfront.amazonaws.com"
      }
      Action   = "s3:GetObject"
      Resource = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.site.arn
        }
      }
    }]
  })
}

################################################################################
# Outputs
################################################################################

output "distribution_id" {
  description = "CloudFront distribution ID (for cache invalidation)"
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.site.domain_name
}

output "bucket_name" {
  description = "S3 bucket name for the site"
  value       = aws_s3_bucket.site.id
}

output "response_headers_policy_id" {
  description = "ID of the response-headers policy attached to the default cache behavior. Empty when no policy is attached."
  value       = local.effective_response_headers_policy_id
}
