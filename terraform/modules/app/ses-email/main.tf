################################################################################
# SES Email — App Module
#
# Wires up inbound and outbound email for a delegated subdomain
# (e.g. agents.thinkwork.ai). The module:
#
#   1. Creates a Route53 hosted zone for the subdomain (Option A — delegated
#      subzone). The operator pastes the output name servers at whatever hosts
#      the parent domain (Google, Squarespace, Cloudflare, etc.).
#   2. Creates the SES domain identity + DKIM tokens.
#   3. Writes the SES verification TXT, DKIM CNAMEs, and an MX record into the
#      new subzone.
#   4. Creates an SES receipt rule set that stores inbound mail in S3 at
#      `email/inbound/<sesMessageId>` and invokes the email-inbound Lambda.
################################################################################

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
}

variable "region" {
  description = "AWS region (determines the inbound SMTP endpoint)"
  type        = string
  default     = "us-east-1"
}

variable "email_domain" {
  description = "Subdomain used for agent email (e.g. agents.thinkwork.ai). Leave empty to skip all SES resources."
  type        = string
  default     = ""
}

variable "inbound_bucket_name" {
  description = "S3 bucket that SES writes raw inbound .eml files into. Its policy must already allow ses.amazonaws.com PutObject."
  type        = string
  default     = ""
}

variable "email_inbound_fn_arn" {
  description = "ARN of the email-inbound Lambda. If empty, receipt rule is still created but without a Lambda action."
  type        = string
  default     = ""
}

variable "email_inbound_fn_name" {
  description = "Function name of the email-inbound Lambda (for the Lambda permission)."
  type        = string
  default     = ""
}

variable "manage_active_rule_set" {
  description = "Activate the receipt rule set. Only ONE rule set can be active per region per account, so set false in secondary stages that share an account."
  type        = bool
  default     = true
}

locals {
  enabled       = var.email_domain != ""
  inbound_smtp  = "inbound-smtp.${var.region}.amazonaws.com"
  rule_set_name = "thinkwork-${var.stage}-email-rules"
  has_lambda    = var.email_inbound_fn_arn != ""
  has_bucket    = var.inbound_bucket_name != ""
}

################################################################################
# Route53 — delegated subzone for the agent email subdomain
################################################################################

resource "aws_route53_zone" "agents" {
  count = local.enabled ? 1 : 0
  name  = var.email_domain

  tags = {
    Name  = "thinkwork-${var.stage}-email-zone"
    Stage = var.stage
  }
}

################################################################################
# SES Domain Identity + DKIM
################################################################################

resource "aws_ses_domain_identity" "main" {
  count  = local.enabled ? 1 : 0
  domain = var.email_domain
}

resource "aws_ses_domain_dkim" "main" {
  count  = local.enabled ? 1 : 0
  domain = aws_ses_domain_identity.main[0].domain
}

################################################################################
# DNS records in the subzone — verification TXT, DKIM CNAMEs, MX
################################################################################

resource "aws_route53_record" "ses_verification" {
  count   = local.enabled ? 1 : 0
  zone_id = aws_route53_zone.agents[0].zone_id
  name    = "_amazonses.${var.email_domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.main[0].verification_token]
}

resource "aws_route53_record" "dkim" {
  count   = local.enabled ? 3 : 0
  zone_id = aws_route53_zone.agents[0].zone_id
  name    = "${aws_ses_domain_dkim.main[0].dkim_tokens[count.index]}._domainkey.${var.email_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "mx" {
  count   = local.enabled ? 1 : 0
  zone_id = aws_route53_zone.agents[0].zone_id
  name    = var.email_domain
  type    = "MX"
  ttl     = 600
  records = ["10 ${local.inbound_smtp}"]
}

################################################################################
# SES Receipt Rule Set + Rule → S3 + Lambda
################################################################################

resource "aws_ses_receipt_rule_set" "main" {
  count         = local.enabled ? 1 : 0
  rule_set_name = local.rule_set_name
}

resource "aws_ses_active_receipt_rule_set" "main" {
  count         = local.enabled && var.manage_active_rule_set ? 1 : 0
  rule_set_name = aws_ses_receipt_rule_set.main[0].rule_set_name
}

resource "aws_lambda_permission" "ses_invoke_email_inbound" {
  count          = local.enabled && local.has_lambda ? 1 : 0
  statement_id   = "AllowSESInvokeEmailInbound"
  action         = "lambda:InvokeFunction"
  function_name  = var.email_inbound_fn_name
  principal      = "ses.amazonaws.com"
  source_account = var.account_id
}

resource "aws_ses_receipt_rule" "inbound" {
  count         = local.enabled ? 1 : 0
  name          = "thinkwork-${var.stage}-inbound-email"
  rule_set_name = aws_ses_receipt_rule_set.main[0].rule_set_name
  recipients    = [var.email_domain]
  enabled       = true
  scan_enabled  = true

  dynamic "s3_action" {
    for_each = local.has_bucket ? [1] : []
    content {
      bucket_name       = var.inbound_bucket_name
      object_key_prefix = "email/inbound/"
      position          = 1
    }
  }

  dynamic "lambda_action" {
    for_each = local.has_lambda ? [1] : []
    content {
      function_arn    = var.email_inbound_fn_arn
      invocation_type = "Event"
      position        = local.has_bucket ? 2 : 1
    }
  }

  depends_on = [aws_lambda_permission.ses_invoke_email_inbound]
}

################################################################################
# Outputs
################################################################################

output "ses_domain_identity_arn" {
  description = "SES domain identity ARN"
  value       = local.enabled ? aws_ses_domain_identity.main[0].arn : null
}

output "dkim_tokens" {
  description = "DKIM tokens (already written as CNAMEs in the subzone)"
  value       = local.enabled ? aws_ses_domain_dkim.main[0].dkim_tokens : []
}

output "zone_id" {
  description = "Route53 hosted zone ID for the email subdomain"
  value       = local.enabled ? aws_route53_zone.agents[0].zone_id : null
}

output "name_servers" {
  description = "Name servers for the delegated email subzone. Paste these as NS records at the registrar that hosts the parent domain (e.g. Google Domains) before SES can verify."
  value       = local.enabled ? aws_route53_zone.agents[0].name_servers : []
}

output "mx_target" {
  description = "MX target host for the email subdomain"
  value       = local.enabled ? local.inbound_smtp : null
}

output "rule_set_name" {
  description = "SES receipt rule set name"
  value       = local.enabled ? aws_ses_receipt_rule_set.main[0].rule_set_name : null
}
