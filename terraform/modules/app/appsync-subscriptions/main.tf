################################################################################
# AppSync Subscriptions — App Module
#
# AppSync exists ONLY as a thin realtime/event layer for subscription fan-out.
# Queries and mutations go through API Gateway V2 → Lambda, NOT through AppSync.
#
# Per Decision 9: the unused RDS data source is removed. Only the NONE
# passthrough data source remains for notification mutations. The schema is
# a subscription-only fragment, not the full product schema.
#
# Post-launch consideration: replace with standard graphql-ws over API Gateway
# V2 WebSocket API. Not v0.1 scope.
################################################################################

################################################################################
# GraphQL API
################################################################################

resource "aws_appsync_graphql_api" "subscriptions" {
  name                = "thinkwork-${var.stage}-subscriptions"
  authentication_type = "API_KEY"
  xray_enabled        = false

  schema = var.subscription_schema

  additional_authentication_provider {
    authentication_type = "AWS_IAM"
  }

  additional_authentication_provider {
    authentication_type = "AMAZON_COGNITO_USER_POOLS"

    user_pool_config {
      user_pool_id = var.user_pool_id
    }
  }

  tags = {
    Name = "thinkwork-${var.stage}-subscriptions"
  }
}

################################################################################
# API Key — 365 day expiry
################################################################################

resource "aws_appsync_api_key" "main" {
  api_id  = aws_appsync_graphql_api.subscriptions.id
  expires = timeadd(timestamp(), "8760h")

  lifecycle {
    ignore_changes = [expires]
  }
}

################################################################################
# NONE Data Source (passthrough for notification mutations)
################################################################################

resource "aws_appsync_datasource" "none" {
  api_id = aws_appsync_graphql_api.subscriptions.id
  name   = "NonePassthrough"
  type   = "NONE"
}

################################################################################
# Notification Mutation Resolvers
#
# v1 events only — deferred events (onEvalRunUpdated, onCostRecorded) are cut.
################################################################################

locals {
  notification_mutations = [
    "notifyAgentStatus",
    "notifyNewMessage",
    "notifyHeartbeatActivity",
    "notifyThreadUpdate",
    "notifyInboxItemUpdate",
    "notifyThreadTurnUpdate",
    "publishComputerThreadChunk",
    "notifyOrgUpdate",
  ]
}

resource "aws_appsync_resolver" "notifications" {
  for_each = toset(local.notification_mutations)

  api_id      = aws_appsync_graphql_api.subscriptions.id
  type        = "Mutation"
  field       = each.value
  data_source = aws_appsync_datasource.none.name

  request_template = <<-EOF
    {"version":"2017-02-28","payload":$util.toJson($context.arguments)}
  EOF

  response_template = <<-EOF
    #set($result = $context.result)
    #if(!$result.updatedAt)
      #set($result.updatedAt = $util.time.nowISO8601())
    #end
    #if(!$result.createdAt)
      #set($result.createdAt = $util.time.nowISO8601())
    #end
    #if(!$result.publishedAt)
      #set($result.publishedAt = $util.time.nowISO8601())
    #end
    $util.toJson($result)
  EOF
}

################################################################################
# Custom Domain (optional)
################################################################################

resource "aws_appsync_domain_name" "main" {
  count           = var.custom_domain != "" ? 1 : 0
  domain_name     = var.custom_domain
  certificate_arn = var.certificate_arn
}

resource "aws_appsync_domain_name_api_association" "main" {
  count       = var.custom_domain != "" ? 1 : 0
  api_id      = aws_appsync_graphql_api.subscriptions.id
  domain_name = aws_appsync_domain_name.main[0].domain_name
}
