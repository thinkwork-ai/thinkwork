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
  authentication_type = "AWS_LAMBDA"
  xray_enabled        = false

  schema = var.subscription_schema

  lambda_authorizer_config {
    authorizer_uri                   = "arn:aws:lambda:${var.region}:${var.account_id}:function:thinkwork-${var.stage}-api-appsync-subscription-authorizer"
    authorizer_result_ttl_in_seconds = 0
    identity_validation_expression   = "^twsub1_[A-Za-z0-9_-]+$"
  }

  additional_authentication_provider {
    authentication_type = "AWS_IAM"
  }

  tags = {
    Name = "thinkwork-${var.stage}-subscriptions"
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
    "notifyThreadActivity",
    "notifyThreadUpdate",
    "notifyInboxItemUpdate",
    "notifyThreadTurnUpdate",
    "notifyThreadTurnStep",
    "notifyOrgUpdate",
    "notifyCostRecorded",
    "notifyEvalRunUpdate",
    "notifyWorkspaceAccessRevoked",
  ]
  subscription_scopes = {
    onAgentStatusChanged     = { argument = "tenantId", kind = "tenant" }
    onNewMessage             = { argument = "threadId", kind = "thread" }
    onHeartbeatActivity      = { argument = "tenantId", kind = "tenant" }
    onThreadUpdated          = { argument = "tenantId", kind = "tenant" }
    onThreadActivity         = { argument = "userId", kind = "user" }
    onInboxItemStatusChanged = { argument = "tenantId", kind = "tenant" }
    onThreadTurnUpdated      = { argument = "tenantId", kind = "tenant" }
    onThreadTurnStep         = { argument = "threadId", kind = "thread" }
    onOrgUpdated             = { argument = "tenantId", kind = "tenant" }
    onCostRecorded           = { argument = "tenantId", kind = "tenant" }
    onEvalRunUpdated         = { argument = "tenantId", kind = "tenant" }
    onWorkspaceAccessRevoked = { argument = "userId", kind = "user" }
  }
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
# Subscription registration filters + active-connection invalidation
################################################################################

resource "aws_appsync_resolver" "subscription_admission" {
  for_each = local.subscription_scopes

  api_id      = aws_appsync_graphql_api.subscriptions.id
  type        = "Subscription"
  field       = each.key
  data_source = aws_appsync_datasource.none.name

  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }

  code = <<-JS
    import { util, extensions } from '@aws-appsync/utils';

    export function request() {
      return { payload: null };
    }

    export function response(ctx) {
      const identity = (ctx.identity && ctx.identity.resolverContext) || {};
      const tenantId = identity.tenantId;
      const userId = identity.stableUserId;
      const resourceKind = identity.resourceKind;
      const resourceId = identity.resourceId;
      if (!tenantId || !userId || !resourceKind || !resourceId) {
        util.unauthorized();
      }

      extensions.setSubscriptionFilter(util.transform.toSubscriptionFilter({
        ${each.value.argument}: { eq: ctx.args.${each.value.argument} },
      }));
      extensions.setSubscriptionInvalidationFilter({
        filterGroup: [
          { filters: [
            { fieldName: 'scope', operator: 'eq', value: 'tenant' },
            { fieldName: 'tenantId', operator: 'eq', value: tenantId },
          ]},
          { filters: [
            { fieldName: 'scope', operator: 'eq', value: 'user' },
            { fieldName: 'tenantId', operator: 'eq', value: tenantId },
            { fieldName: 'userId', operator: 'eq', value: userId },
          ]},
          { filters: [
            { fieldName: 'scope', operator: 'eq', value: 'resource' },
            { fieldName: 'tenantId', operator: 'eq', value: tenantId },
            { fieldName: 'userId', operator: 'eq', value: userId },
            { fieldName: 'resourceKind', operator: 'eq', value: resourceKind },
            { fieldName: 'resourceId', operator: 'eq', value: resourceId },
          ]},
        ],
      });
      return null;
    }
  JS
}

resource "aws_appsync_resolver" "subscription_invalidation" {
  api_id      = aws_appsync_graphql_api.subscriptions.id
  type        = "Mutation"
  field       = "invalidateSubscription"
  data_source = aws_appsync_datasource.none.name

  runtime {
    name            = "APPSYNC_JS"
    runtime_version = "1.0.0"
  }

  code = <<-JS
    import { util, extensions } from '@aws-appsync/utils';

    const fields = {
      ON_AGENT_STATUS_CHANGED: 'onAgentStatusChanged',
      ON_NEW_MESSAGE: 'onNewMessage',
      ON_HEARTBEAT_ACTIVITY: 'onHeartbeatActivity',
      ON_THREAD_UPDATED: 'onThreadUpdated',
      ON_THREAD_ACTIVITY: 'onThreadActivity',
      ON_INBOX_ITEM_STATUS_CHANGED: 'onInboxItemStatusChanged',
      ON_THREAD_TURN_UPDATED: 'onThreadTurnUpdated',
      ON_THREAD_TURN_STEP: 'onThreadTurnStep',
      ON_ORG_UPDATED: 'onOrgUpdated',
      ON_COST_RECORDED: 'onCostRecorded',
      ON_EVAL_RUN_UPDATED: 'onEvalRunUpdated',
      ON_WORKSPACE_ACCESS_REVOKED: 'onWorkspaceAccessRevoked',
    };

    export function request(ctx) {
      return { payload: { ...ctx.args, subscriptionField: fields[ctx.args.subscriptionField] } };
    }

    export function response(ctx) {
      const payload = ctx.result;
      if (!payload.subscriptionField) util.error('Invalid subscription field');
      extensions.invalidateSubscriptions({
        subscriptionField: payload.subscriptionField,
        payload,
      });
      return payload;
    }
  JS
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
