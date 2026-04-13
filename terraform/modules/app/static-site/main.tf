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

################################################################################
# S3 Bucket
################################################################################

locals {
  bucket_name = var.bucket_name != "" ? var.bucket_name : "thinkwork-${var.stage}-${var.site_name}"
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
# Not needed (and harmful) for SPAs: a deep route like /humans would be
# rewritten to /humans/index.html, which S3 doesn't have — 403 from S3
# instead of letting the SPA fallback below serve /index.html.
################################################################################

resource "aws_cloudfront_function" "rewrite" {
  count   = var.is_spa ? 0 : 1
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
    target_origin_id       = "s3-${local.bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    dynamic "function_association" {
      for_each = var.is_spa ? [] : [1]
      content {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.rewrite[0].arn
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
