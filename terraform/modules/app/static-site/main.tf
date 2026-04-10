################################################################################
# Static Site — App Module
#
# S3 + CloudFront distribution for static web apps (apps/hive, docs site).
# Reusable for any static frontend that needs a CDN + custom domain.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "site_name" {
  description = "Identifier for the site (e.g. hive, docs)"
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

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
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
