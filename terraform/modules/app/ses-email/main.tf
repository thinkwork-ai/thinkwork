################################################################################
# SES Email — App Module
#
# Wires up inbound and outbound email for a legacy delegated subdomain
# (e.g. agents.thinkwork.ai) plus delegated tenant subdomains
# (e.g. acme.thinkwork.ai). The module:
#
#   1. Keeps the legacy Route53 hosted zone for agents.thinkwork.ai when
#      configured, and creates one Route53 hosted zone per tenant subdomain
#      (Option A — delegated subzones). The operator publishes each output
#      name-server set at whatever hosts the parent domain (Cloudflare, Google,
#      etc.).
#   2. Creates SES domain identities + DKIM token sets for the configured
#      legacy domain and each tenant subdomain.
#   3. Writes SES verification TXT, DKIM CNAME, and MX records into the matching
#      subzone.
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

variable "parent_domain" {
  description = "Parent domain for tenant email subdomains (e.g. thinkwork.ai). Leave empty to skip all SES resources."
  type        = string
  default     = ""
}

variable "email_domain" {
  description = "Legacy delegated subdomain used for agent email (e.g. agents.thinkwork.ai). Kept until legacy-address retirement notices are no longer needed."
  type        = string
  default     = ""
}

variable "tenant_slugs" {
  description = "Tenant slugs to provision as SES receiving subdomains under parent_domain. Each slug creates <slug>.<parent_domain>."
  type        = set(string)
  default     = []
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
  tenant_slugs   = toset(var.tenant_slugs)
  legacy_enabled = var.email_domain != ""
  tenant_enabled = var.parent_domain != "" && length(local.tenant_slugs) > 0
  enabled        = local.legacy_enabled || local.tenant_enabled

  tenant_domains = {
    for slug in local.tenant_slugs : slug => "${slug}.${var.parent_domain}"
  }

  tenant_dkim_records = local.tenant_enabled ? {
    for pair in setproduct(sort(tolist(local.tenant_slugs)), range(3)) : "${pair[0]}-${pair[1]}" => {
      slug  = pair[0]
      index = pair[1]
    }
  } : {}

  inbound_smtp  = "inbound-smtp.${var.region}.amazonaws.com"
  rule_set_name = "thinkwork-${var.stage}-email-rules"
  has_lambda    = var.email_inbound_fn_arn != ""
  has_bucket    = var.inbound_bucket_name != ""
}

################################################################################
# Route53 — delegated subzones for legacy + tenant email subdomains
################################################################################

resource "aws_route53_zone" "agents" {
  count = local.legacy_enabled ? 1 : 0
  name  = var.email_domain

  tags = {
    Name  = "thinkwork-${var.stage}-email-zone"
    Stage = var.stage
  }
}

resource "aws_route53_zone" "tenant" {
  for_each = local.tenant_enabled ? local.tenant_domains : {}
  name     = each.value

  tags = {
    Name       = "thinkwork-${var.stage}-${each.key}-email-zone"
    Stage      = var.stage
    TenantSlug = each.key
  }
}

################################################################################
# SES Domain Identities + DKIM for legacy + tenant subdomains
################################################################################

resource "aws_ses_domain_identity" "main" {
  count  = local.legacy_enabled ? 1 : 0
  domain = var.email_domain
}

resource "aws_ses_domain_dkim" "main" {
  count  = local.legacy_enabled ? 1 : 0
  domain = aws_ses_domain_identity.main[0].domain
}

resource "aws_ses_domain_identity" "tenant" {
  for_each = local.tenant_enabled ? local.tenant_domains : {}
  domain   = each.value
}

resource "aws_ses_domain_dkim" "tenant" {
  for_each = local.tenant_enabled ? local.tenant_domains : {}
  domain   = aws_ses_domain_identity.tenant[each.key].domain
}

################################################################################
# DNS records in legacy + tenant subzones — verification TXT, DKIM CNAMEs, MX
################################################################################

resource "aws_route53_record" "ses_verification" {
  count   = local.legacy_enabled ? 1 : 0
  zone_id = aws_route53_zone.agents[0].zone_id
  name    = "_amazonses.${var.email_domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.main[0].verification_token]
}

resource "aws_route53_record" "tenant_ses_verification" {
  for_each = local.tenant_enabled ? local.tenant_domains : {}
  zone_id  = aws_route53_zone.tenant[each.key].zone_id
  name     = "_amazonses.${each.value}"
  type     = "TXT"
  ttl      = 600
  records  = [aws_ses_domain_identity.tenant[each.key].verification_token]
}

resource "aws_route53_record" "dkim" {
  count   = local.legacy_enabled ? 3 : 0
  zone_id = aws_route53_zone.agents[0].zone_id
  name    = "${aws_ses_domain_dkim.main[0].dkim_tokens[count.index]}._domainkey.${var.email_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "tenant_dkim" {
  for_each = local.tenant_dkim_records
  zone_id  = aws_route53_zone.tenant[each.value.slug].zone_id
  name     = "${aws_ses_domain_dkim.tenant[each.value.slug].dkim_tokens[each.value.index]}._domainkey.${local.tenant_domains[each.value.slug]}"
  type     = "CNAME"
  ttl      = 600
  records  = ["${aws_ses_domain_dkim.tenant[each.value.slug].dkim_tokens[each.value.index]}.dkim.amazonses.com"]
}

resource "aws_route53_record" "mx" {
  count   = local.legacy_enabled ? 1 : 0
  zone_id = aws_route53_zone.agents[0].zone_id
  name    = var.email_domain
  type    = "MX"
  ttl     = 600
  records = ["10 ${local.inbound_smtp}"]
}

resource "aws_route53_record" "tenant_mx" {
  for_each = local.tenant_enabled ? local.tenant_domains : {}
  zone_id  = aws_route53_zone.tenant[each.key].zone_id
  name     = each.value
  type     = "MX"
  ttl      = 600
  records  = ["10 ${local.inbound_smtp}"]
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
  recipients    = []
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

output "ses_domain_identity_arns" {
  description = "SES domain identity ARNs by tenant slug"
  value = {
    for slug, identity in aws_ses_domain_identity.tenant : slug => identity.arn
  }
}

output "ses_domain_identity_arn" {
  description = "Legacy SES domain identity ARN"
  value       = local.legacy_enabled ? aws_ses_domain_identity.main[0].arn : null
}

output "tenant_dkim_tokens" {
  description = "DKIM tokens by tenant slug (already written as CNAMEs in each subzone)"
  value = {
    for slug, dkim in aws_ses_domain_dkim.tenant : slug => dkim.dkim_tokens
  }
}

output "dkim_tokens" {
  description = "Legacy DKIM tokens (already written as CNAMEs in the legacy subzone)"
  value       = local.legacy_enabled ? aws_ses_domain_dkim.main[0].dkim_tokens : []
}

output "zone_ids" {
  description = "Route53 hosted zone IDs by tenant slug"
  value = {
    for slug, zone in aws_route53_zone.tenant : slug => zone.zone_id
  }
}

output "zone_id" {
  description = "Legacy Route53 hosted zone ID"
  value       = local.legacy_enabled ? aws_route53_zone.agents[0].zone_id : null
}

output "tenant_name_servers" {
  description = "Name servers by tenant slug. Publish each set as NS records at the parent domain host before SES can verify."
  value = {
    for slug, zone in aws_route53_zone.tenant : slug => zone.name_servers
  }
}

output "name_servers" {
  description = "Legacy email subzone name servers"
  value       = local.legacy_enabled ? aws_route53_zone.agents[0].name_servers : []
}

output "mx_target" {
  description = "MX target host for each tenant email subdomain"
  value       = local.enabled ? local.inbound_smtp : null
}

output "rule_set_name" {
  description = "SES receipt rule set name"
  value       = local.enabled ? aws_ses_receipt_rule_set.main[0].rule_set_name : null
}
