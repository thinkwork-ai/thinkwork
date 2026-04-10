################################################################################
# SES Email — App Module
#
# Configures SES for email inbound (receipt rules) and domain verification.
# Full Lambda wiring comes in Phase 4 when email handlers are migrated.
# Phase 1 creates the domain identity and DKIM records only.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "email_domain" {
  description = "Domain for SES email (e.g. thinkwork.ai)"
  type        = string
  default     = ""
}

################################################################################
# SES Domain Identity (only if email_domain is provided)
################################################################################

resource "aws_ses_domain_identity" "main" {
  count  = var.email_domain != "" ? 1 : 0
  domain = var.email_domain
}

resource "aws_ses_domain_dkim" "main" {
  count  = var.email_domain != "" ? 1 : 0
  domain = aws_ses_domain_identity.main[0].domain
}

################################################################################
# Outputs
################################################################################

output "ses_domain_identity_arn" {
  description = "SES domain identity ARN"
  value       = var.email_domain != "" ? aws_ses_domain_identity.main[0].arn : null
}

output "dkim_tokens" {
  description = "DKIM tokens for DNS verification"
  value       = var.email_domain != "" ? aws_ses_domain_dkim.main[0].dkim_tokens : []
}
