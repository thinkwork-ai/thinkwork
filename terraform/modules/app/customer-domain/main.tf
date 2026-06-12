################################################################################
# Customer Domain — App Module (<name>.thinkwork.ai)
#
# Owns the customer-account half of the customer-domain namespace: a Route53
# hosted zone for the NS-delegated subdomain plus, once delegation has
# resolved, the ACM certificate and web alias records that put the end-user
# app on https://<name>.thinkwork.ai.
#
# Responsibilities:
#   1. Route53 hosted zone for the customer domain whenever one is configured
#      (pre-delegation: the zone exists but nothing resolves to it). The four
#      name servers are surfaced as outputs so the shared claim tool can run
#      its phase-two `claim --set-targets <ns...>` against the Cloudflare
#      apex zone.
#   2. CAA record `0 issue "amazon.com"` published with the zone, so the
#      delegated subtree can only ever obtain Amazon-issued (ACM)
#      certificates.
#   3. Gated on customer_domain_delegated: ACM certificate in us-east-1
#      (CloudFront requires us-east-1 certs; provided via the aws.us_east_1
#      provider alias), DNS validation records written into this module's
#      own zone (single apply once delegation resolves), and a validation
#      waiter with an explicit fail-fast timeout — a pre-delegation gate
#      flip must fail in minutes, not hang a CodeBuild run for hours.
#   4. Gated on customer_domain_delegated: A/AAAA alias records pointing the
#      customer domain at the end-user app CloudFront distribution.
#   5. SES send + receive for the customer domain (gated only on
#      customer_domain being set, NOT on delegation): domain identity, DKIM,
#      custom MAIL FROM, inbound MX, DMARC, and a domain-level receipt rule
#      routing inbound mail to the S3 bucket + email-inbound Lambda.
#
# SES verification timing: the identity and its DNS records are created as
# soon as customer_domain is set — intentionally pre-delegation, so the
# records are already in place the instant the NS hop lands. SES's pending
# verification attempt expires after ~72 hours, however. If delegation lands
# later than that, re-trigger verification before any consumer gates on the
# identity (e.g. before switching cognito_email_source_arn):
#
#   terraform taint 'module.customer_domain.aws_ses_domain_identity.customer[0]'
#   terraform apply
#
# (or `terraform apply -replace=...` of the same address). The full
# procedure lives in the claim runbook:
# docs/runbooks/customer-domain-claim-runbook.md.
#
# Receipt rule-set semantics (KTD6): SES allows exactly ONE active receipt
# rule set per account/region, and the semantics differ by account kind:
#   - Customer accounts: no other Terraform-managed rule set exists (the
#     deployment controller threads zero ses_* vars), so THIS module is the
#     single owner — it creates its own rule set and activates it when
#     manage_active_rule_set is true (the default the thinkwork module
#     computes when the ses-email module is disabled).
#   - SaaS account: the ses-email module owns the active rule set
#     (thinkwork-<stage>-email-rules). If both modules are ever enabled in
#     one account, this module still creates its (distinctly named) rule
#     set but must NOT activate it — the caller passes
#     manage_active_rule_set = false so activation never flips away from
#     the ses-email set and silently drops inbound mail for the SaaS
#     tenant identities.
#
# Cycle avoidance: every resource count gates on plain bool/string vars,
# never on downstream CloudFront outputs — the app distribution consumes
# this module's certificate, so the certificate (and everything its count
# depends on) must not depend on distribution outputs. Only the alias
# records' *attributes* reference the distribution domain, which keeps the
# resource graph acyclic: cert → distribution → alias records.
################################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"

      # CloudFront only accepts certificates from us-east-1. Callers must
      # pass an aliased us-east-1 provider:
      #   providers = { aws.us_east_1 = aws.us_east_1 }
      configuration_aliases = [aws.us_east_1]
    }
  }
}

variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "customer_domain" {
  description = "Customer domain to host in this account (e.g. tei.thinkwork.ai). Leave empty to create nothing."
  type        = string
  default     = ""
}

variable "customer_domain_delegated" {
  description = "Set true once the parent zone's NS records point at this zone (claim tool phase two). Gates the ACM certificate, its validation, and the web alias records."
  type        = bool
  default     = false
}

variable "app_distribution_domain_name" {
  description = "CloudFront distribution domain name of the end-user app (e.g. dxxxx.cloudfront.net). Target of the A/AAAA alias records. May be unknown at plan time — it never drives a resource count."
  type        = string
  default     = ""
}

variable "region" {
  description = "AWS region of the stack (determines the SES inbound SMTP endpoint and the MAIL FROM feedback MX target)."
  type        = string
  default     = "us-east-1"
}

variable "account_id" {
  description = "AWS account ID (source_account on the SES → email-inbound Lambda invoke permission)."
  type        = string
  default     = ""
}

variable "inbound_bucket_name" {
  description = "S3 bucket that SES writes raw inbound .eml files into. Its policy must already allow ses.amazonaws.com PutObject."
  type        = string
  default     = ""
}

variable "email_inbound_fn_arn" {
  description = "ARN of the email-inbound Lambda. If empty, the receipt rule is still created but without a Lambda action."
  type        = string
  default     = ""
}

variable "email_inbound_fn_name" {
  description = "Function name of the email-inbound Lambda (for the Lambda invoke permission)."
  type        = string
  default     = ""
}

variable "enable_email_inbound_lambda_action" {
  description = "Attach the email-inbound Lambda action and invoke permission to the customer-domain receipt rule."
  type        = bool
  default     = false
}

variable "manage_active_rule_set" {
  description = "Activate this module's receipt rule set. Only ONE rule set can be active per region per AWS account (KTD6): true in customer accounts (where this module is the sole rule-set owner), false whenever the ses-email module is enabled in the same account — its thinkwork-<stage>-email-rules set must stay active."
  type        = bool
  default     = true
}

locals {
  zone_enabled = var.customer_domain != ""
  cert_enabled = local.zone_enabled && var.customer_domain_delegated

  # SES resources gate on the same condition as the zone: the identity (and
  # all its DNS records) intentionally exist pre-delegation so verification
  # can succeed the moment the NS hop resolves. See the ~72h verification
  # expiry note in the module header.
  ses_enabled = local.zone_enabled

  name_id = replace(var.customer_domain, ".", "-")

  # Custom MAIL FROM subdomain. Lives under the customer domain so the
  # envelope sender (Return-Path) aligns with the From domain for SPF.
  mail_from_domain = "mail.${var.customer_domain}"

  inbound_smtp = "inbound-smtp.${var.region}.amazonaws.com"

  # Distinct from ses-email's thinkwork-<stage>-email-rules so the two
  # modules can never collide on rule-set NAME even when both are enabled
  # in one account (KTD6 — activation is what's mutually exclusive).
  rule_set_name = "thinkwork-${var.stage}-customer-domain-email-rules"

  has_lambda = local.ses_enabled && var.enable_email_inbound_lambda_action
  has_bucket = var.inbound_bucket_name != ""

  # Universal hosted zone ID for CloudFront distributions — a documented AWS
  # constant, identical for every distribution in every account.
  cloudfront_hosted_zone_id = "Z2FDTNDATAQYW2"
}

################################################################################
# Hosted zone + CAA (created with the zone, pre-delegation)
################################################################################

resource "aws_route53_zone" "customer" {
  count = local.zone_enabled ? 1 : 0

  name    = var.customer_domain
  comment = "thinkwork-${var.stage} customer domain"

  tags = {
    Name = "thinkwork-${var.stage}-customer-domain-zone"
  }
}

# Published at zone creation so that from the instant delegation resolves,
# only Amazon's CAs may issue certificates for the delegated subtree.
# Per ACM docs, `issue "amazon.com"` authorizes all four Amazon CA domains.
resource "aws_route53_record" "caa" {
  count = local.zone_enabled ? 1 : 0

  zone_id = aws_route53_zone.customer[0].zone_id
  name    = var.customer_domain
  type    = "CAA"
  ttl     = 300
  records = ["0 issue \"amazon.com\""]
}

################################################################################
# ACM certificate (us-east-1) + DNS validation in our own zone
#
# Validation records live in this module's zone, so once the NS hop resolves
# the certificate validates in the same apply that creates it (no second
# out-of-band step beyond flipping customer_domain_delegated).
################################################################################

resource "aws_acm_certificate" "customer" {
  count    = local.cert_enabled ? 1 : 0
  provider = aws.us_east_1

  domain_name       = var.customer_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "thinkwork-${var.stage}-${local.name_id}"
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = {
    for dvo in(local.cert_enabled ? aws_acm_certificate.customer[0].domain_validation_options : []) :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.customer[0].zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "customer" {
  count    = local.cert_enabled ? 1 : 0
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.customer[0].arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]

  # Fail fast (KTD3): the default validation timeout is far too generous for
  # a gate that should only ever be flipped after delegation resolved. If
  # validation hasn't succeeded in 30 minutes the NS hop almost certainly
  # hasn't landed — fail the apply instead of hanging the deploy runner.
  timeouts {
    create = "30m"
  }
}

################################################################################
# Web alias records → end-user app CloudFront distribution
#
# Counts gate on the same plain bool as the certificate (never on the
# distribution output, which is unknown at plan time on greenfield).
################################################################################

resource "aws_route53_record" "app_alias_a" {
  count = local.cert_enabled ? 1 : 0

  zone_id = aws_route53_zone.customer[0].zone_id
  name    = var.customer_domain
  type    = "A"

  alias {
    name                   = var.app_distribution_domain_name
    zone_id                = local.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app_alias_aaaa" {
  count = local.cert_enabled ? 1 : 0

  zone_id = aws_route53_zone.customer[0].zone_id
  name    = var.customer_domain
  type    = "AAAA"

  alias {
    name                   = var.app_distribution_domain_name
    zone_id                = local.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

################################################################################
# SES identity — send (DKIM + custom MAIL FROM) for the customer domain
#
# Everything here gates on ses_enabled (= customer_domain set), NOT on the
# delegation gate: the DNS answers only become publicly resolvable once the
# NS hop lands, and SES verification flips to Success on its next poll after
# that (subject to the ~72h expiry documented in the header).
################################################################################

resource "aws_ses_domain_identity" "customer" {
  count  = local.ses_enabled ? 1 : 0
  domain = var.customer_domain
}

resource "aws_route53_record" "ses_verification" {
  count   = local.ses_enabled ? 1 : 0
  zone_id = aws_route53_zone.customer[0].zone_id
  name    = "_amazonses.${var.customer_domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.customer[0].verification_token]
}

resource "aws_ses_domain_dkim" "customer" {
  count  = local.ses_enabled ? 1 : 0
  domain = aws_ses_domain_identity.customer[0].domain
}

# Plan-time-known count (3 DKIM tokens always) — never derived from the
# dkim_tokens attribute, which is unknown until apply.
resource "aws_route53_record" "dkim" {
  count   = local.ses_enabled ? 3 : 0
  zone_id = aws_route53_zone.customer[0].zone_id
  name    = "${aws_ses_domain_dkim.customer[0].dkim_tokens[count.index]}._domainkey.${var.customer_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.customer[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

# Custom MAIL FROM so the envelope sender (Return-Path) lives under the
# customer domain instead of amazonses.com — SPF-aligned DMARC passes.
resource "aws_ses_domain_mail_from" "customer" {
  count            = local.ses_enabled ? 1 : 0
  domain           = aws_ses_domain_identity.customer[0].domain
  mail_from_domain = local.mail_from_domain

  # Fall back to amazonses.com if the MAIL FROM MX ever fails to resolve
  # (e.g. pre-delegation) rather than rejecting the send outright.
  behavior_on_mx_failure = "UseDefaultValue"
}

resource "aws_route53_record" "mail_from_mx" {
  count   = local.ses_enabled ? 1 : 0
  zone_id = aws_route53_zone.customer[0].zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  count   = local.ses_enabled ? 1 : 0
  zone_id = aws_route53_zone.customer[0].zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

# DMARC: monitoring-only to start (p=none). Tightening to quarantine/reject
# is a deliberate later step once sending reputation is established.
# Precondition pinned in the plan (resolved 2026-06-12): the thinkwork.ai
# apex publishes NO DMARC record, so no sp= policy overrides this one.
resource "aws_route53_record" "dmarc" {
  count   = local.ses_enabled ? 1 : 0
  zone_id = aws_route53_zone.customer[0].zone_id
  name    = "_dmarc.${var.customer_domain}"
  type    = "TXT"
  ttl     = 600
  records = ["v=DMARC1; p=none"]
}

################################################################################
# SES receive — inbound MX + receipt rule set → S3 + email-inbound Lambda
#
# KTD6 (see header): in customer accounts this module is the single owner of
# rule-set mutation — it creates AND activates its own rule set. In any
# account where the ses-email module is enabled, the caller passes
# manage_active_rule_set = false so the ses-email set stays active.
################################################################################

resource "aws_route53_record" "inbound_mx" {
  count   = local.ses_enabled ? 1 : 0
  zone_id = aws_route53_zone.customer[0].zone_id
  name    = var.customer_domain
  type    = "MX"
  ttl     = 600
  records = ["10 ${local.inbound_smtp}"]
}

resource "aws_ses_receipt_rule_set" "customer" {
  count         = local.ses_enabled ? 1 : 0
  rule_set_name = local.rule_set_name
}

resource "aws_ses_active_receipt_rule_set" "customer" {
  count         = local.ses_enabled && var.manage_active_rule_set ? 1 : 0
  rule_set_name = aws_ses_receipt_rule_set.customer[0].rule_set_name
}

# Distinct statement_id from ses-email's AllowSESInvokeEmailInbound so the
# two permissions can coexist on the same function in a shared account.
resource "aws_lambda_permission" "ses_invoke_email_inbound" {
  count          = local.has_lambda ? 1 : 0
  statement_id   = "AllowSESInvokeEmailInboundCustomerDomain"
  action         = "lambda:InvokeFunction"
  function_name  = var.email_inbound_fn_name
  principal      = "ses.amazonaws.com"
  source_account = var.account_id
}

# Domain-level recipient: matches every address at the customer domain
# (agent@tei.thinkwork.ai, space addresses, …) — routing past this point is
# the email-inbound Lambda's lookup logic, not per-address SES rules.
resource "aws_ses_receipt_rule" "inbound" {
  count         = local.ses_enabled ? 1 : 0
  name          = "thinkwork-${var.stage}-customer-domain-inbound-email"
  rule_set_name = aws_ses_receipt_rule_set.customer[0].rule_set_name
  recipients    = [var.customer_domain]
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

output "zone_id" {
  description = "Route53 hosted zone ID for the customer domain (empty when no domain is configured)"
  value       = local.zone_enabled ? aws_route53_zone.customer[0].zone_id : ""
}

output "name_servers" {
  description = "The four Route53 name servers for the customer zone — phase-two input for the claim tool's `claim --set-targets` (empty when no domain is configured)"
  value       = local.zone_enabled ? aws_route53_zone.customer[0].name_servers : []
}

output "certificate_arn" {
  description = "Validated ACM certificate ARN for the customer domain (us-east-1; empty until customer_domain_delegated is true and validation succeeds)"
  value       = local.cert_enabled ? aws_acm_certificate_validation.customer[0].certificate_arn : ""
}

output "ses_identity_arn" {
  description = "SES domain identity ARN for the customer domain (empty when no domain is configured). Candidate cognito_email_source_arn value — switching Cognito email to it is an operator action taken only after the identity verifies and SES production access is granted (R11), never automatic."
  value       = local.ses_enabled ? aws_ses_domain_identity.customer[0].arn : ""
}

output "rule_set_name" {
  description = "SES receipt rule set name owned by this module (empty when no domain is configured). Active only when manage_active_rule_set is true — see the KTD6 note in the module header."
  value       = local.ses_enabled ? aws_ses_receipt_rule_set.customer[0].rule_set_name : ""
}
