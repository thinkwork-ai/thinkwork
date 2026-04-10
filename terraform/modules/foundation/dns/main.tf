################################################################################
# DNS — Foundation Module
#
# Manages a Route53 hosted zone, or accepts an existing zone ID.
# Other modules reference the zone for custom domains (AppSync, API Gateway,
# CloudFront, docs site).
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "create_zone" {
  description = "Whether to create a new Route53 hosted zone. Set to false to use an existing zone."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Domain name for the hosted zone (e.g. thinkwork.ai)"
  type        = string
  default     = ""
}

variable "existing_zone_id" {
  description = "ID of an existing Route53 hosted zone (required when create_zone = false)"
  type        = string
  default     = null
}

resource "aws_route53_zone" "main" {
  count = var.create_zone ? 1 : 0
  name  = var.domain_name

  tags = {
    Name = "thinkwork-${var.stage}-zone"
  }
}

output "zone_id" {
  description = "Route53 hosted zone ID (created or existing)"
  value       = var.create_zone ? aws_route53_zone.main[0].zone_id : var.existing_zone_id
}

output "name_servers" {
  description = "Name servers for the zone (only available when create_zone = true)"
  value       = var.create_zone ? aws_route53_zone.main[0].name_servers : []
}
