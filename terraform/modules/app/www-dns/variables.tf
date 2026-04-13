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

variable "include_docs" {
  description = "When true, add docs.<domain> to the ACM cert SANs and create a Cloudflare CNAME for it. Separated from docs_cloudfront_domain_name to avoid a Terraform dependency cycle (distribution depends on cert, so the cert can't depend on the distribution output)."
  type        = bool
  default     = false
}

variable "docs_cloudfront_domain_name" {
  description = "CloudFront distribution domain name for the docs site. Used as the target for the docs.<domain> Cloudflare CNAME when include_docs is true."
  type        = string
  default     = ""
}

variable "include_admin" {
  description = "When true, add admin.<domain> to the ACM cert SANs and create a Cloudflare CNAME for it. Same cycle-avoidance rationale as include_docs."
  type        = bool
  default     = false
}

variable "admin_cloudfront_domain_name" {
  description = "CloudFront distribution domain name for the admin SPA. Used as the target for the admin.<domain> Cloudflare CNAME when include_admin is true."
  type        = string
  default     = ""
}
