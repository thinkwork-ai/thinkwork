variable "stage" {
  description = "Deployment stage (used for resource naming)"
  type        = string
}

variable "domain" {
  description = "Apex domain served by the public website (e.g. thinkwork.ai)"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the apex domain. Non-secret; lives in tfvars."
  type        = string
}

variable "cloudfront_domain_name" {
  description = "CloudFront distribution domain name for the primary www site (e.g. d123.cloudfront.net). Passed in from the static-site module output."
  type        = string
}

variable "docs_cloudfront_domain_name" {
  description = "CloudFront distribution domain name for the docs site. When set, docs.<domain> is added to the ACM cert SANs and a Cloudflare CNAME is created pointing at this distribution."
  type        = string
  default     = ""
}
