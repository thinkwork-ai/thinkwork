################################################################################
# Thinkwork Composite Root
#
# Wires the three tiers (foundation → data → app) together with sensible
# defaults. This is the module published to the Terraform Registry as
# `thinkwork-ai/thinkwork/aws`.
#
# For advanced composition, use the sub-modules directly:
#   source = "thinkwork-ai/thinkwork/aws//modules/foundation/vpc"
################################################################################

locals {
  bucket_name = var.bucket_name != "" ? var.bucket_name : "thinkwork-${var.stage}-storage"
}

################################################################################
# Workspace Guard
################################################################################

module "workspace_guard" {
  source = "../_internal/workspace-guard"
  stage  = var.stage
}

################################################################################
# Foundation Tier
################################################################################

module "vpc" {
  source = "../foundation/vpc"

  stage                       = var.stage
  create_vpc                  = var.create_vpc
  existing_vpc_id             = var.existing_vpc_id
  existing_public_subnet_ids  = var.existing_public_subnet_ids
  existing_private_subnet_ids = var.existing_private_subnet_ids
}

module "kms" {
  source = "../foundation/kms"
  stage  = var.stage
}

module "cognito" {
  source = "../foundation/cognito"

  stage  = var.stage
  region = var.region

  create_cognito              = var.create_cognito
  existing_user_pool_id       = var.existing_user_pool_id
  existing_user_pool_arn      = var.existing_user_pool_arn
  existing_hive_client_id     = var.existing_hive_client_id
  existing_hive_app_client_id = var.existing_hive_app_client_id
  existing_identity_pool_id   = var.existing_identity_pool_id

  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  pre_signup_lambda_zip      = var.pre_signup_lambda_zip

  hive_callback_urls   = var.hive_callback_urls
  hive_logout_urls     = var.hive_logout_urls
  mobile_callback_urls = var.mobile_callback_urls
  mobile_logout_urls   = var.mobile_logout_urls
}

module "dns" {
  source = "../foundation/dns"
  stage  = var.stage
}

################################################################################
# Data Tier
################################################################################

module "s3" {
  source = "../data/s3-buckets"

  stage       = var.stage
  account_id  = var.account_id
  bucket_name = local.bucket_name
}

module "database" {
  source = "../data/aurora-postgres"

  stage  = var.stage

  create_database               = var.create_database
  existing_db_cluster_arn       = var.existing_db_cluster_arn
  existing_db_secret_arn        = var.existing_db_secret_arn
  existing_db_endpoint          = var.existing_db_endpoint
  existing_db_security_group_id = var.existing_db_security_group_id

  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.public_subnet_ids
  db_password = var.db_password

  database_name = var.database_name
}

module "bedrock_kb" {
  source = "../data/bedrock-knowledge-base"

  stage       = var.stage
  account_id  = var.account_id
  region      = var.region
  bucket_name = module.s3.bucket_name
}

################################################################################
# App Tier
################################################################################

# Subscription-only schema for AppSync (v1 events only)
locals {
  subscription_schema = <<-GRAPHQL
    type Mutation {
      notifyAgentStatus(input: AWSJSON!): AWSJSON @aws_api_key @aws_cognito_user_pools @aws_iam
      notifyNewMessage(input: AWSJSON!): AWSJSON @aws_api_key @aws_cognito_user_pools @aws_iam
      notifyHeartbeatActivity(input: AWSJSON!): AWSJSON @aws_api_key @aws_cognito_user_pools @aws_iam
      notifyThreadUpdate(input: AWSJSON!): AWSJSON @aws_api_key @aws_cognito_user_pools @aws_iam
      notifyInboxItemUpdate(input: AWSJSON!): AWSJSON @aws_api_key @aws_cognito_user_pools @aws_iam
      notifyThreadTurnUpdate(input: AWSJSON!): AWSJSON @aws_api_key @aws_cognito_user_pools @aws_iam
      notifyOrgUpdate(input: AWSJSON!): AWSJSON @aws_api_key @aws_cognito_user_pools @aws_iam
    }

    type Subscription {
      onAgentStatusChanged: AWSJSON @aws_subscribe(mutations: ["notifyAgentStatus"]) @aws_api_key @aws_cognito_user_pools @aws_iam
      onNewMessage: AWSJSON @aws_subscribe(mutations: ["notifyNewMessage"]) @aws_api_key @aws_cognito_user_pools @aws_iam
      onHeartbeatActivity: AWSJSON @aws_subscribe(mutations: ["notifyHeartbeatActivity"]) @aws_api_key @aws_cognito_user_pools @aws_iam
      onThreadUpdated: AWSJSON @aws_subscribe(mutations: ["notifyThreadUpdate"]) @aws_api_key @aws_cognito_user_pools @aws_iam
      onInboxItemStatusChanged: AWSJSON @aws_subscribe(mutations: ["notifyInboxItemUpdate"]) @aws_api_key @aws_cognito_user_pools @aws_iam
      onThreadTurnUpdated: AWSJSON @aws_subscribe(mutations: ["notifyThreadTurnUpdate"]) @aws_api_key @aws_cognito_user_pools @aws_iam
      onOrgUpdated: AWSJSON @aws_subscribe(mutations: ["notifyOrgUpdate"]) @aws_api_key @aws_cognito_user_pools @aws_iam
    }

    schema {
      mutation: Mutation
      subscription: Subscription
    }
  GRAPHQL
}

module "appsync" {
  source = "../app/appsync-subscriptions"

  stage               = var.stage
  region              = var.region
  user_pool_id        = module.cognito.user_pool_id
  subscription_schema = local.subscription_schema
}

module "api" {
  source = "../app/lambda-api"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region

  lambda_artifact_bucket = var.lambda_artifact_bucket
  lambda_artifact_prefix = var.lambda_artifact_prefix

  db_cluster_arn        = module.database.db_cluster_arn
  graphql_db_secret_arn = module.database.graphql_db_secret_arn
  database_name         = var.database_name

  bucket_name = module.s3.bucket_name
  bucket_arn  = module.s3.bucket_arn

  user_pool_id       = module.cognito.user_pool_id
  user_pool_arn      = module.cognito.user_pool_arn
  hive_client_id     = module.cognito.hive_client_id
  hive_app_client_id = module.cognito.hive_app_client_id

  appsync_api_url = module.appsync.graphql_api_url
  appsync_api_key = module.appsync.graphql_api_key

  kb_service_role_arn = module.bedrock_kb.kb_service_role_arn
}

module "agentcore" {
  source = "../app/agentcore-runtime"

  stage       = var.stage
  account_id  = var.account_id
  region      = var.region
  bucket_name = module.s3.bucket_name
}

module "crons" {
  source = "../app/crons"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region
}

module "job_triggers" {
  source = "../app/job-triggers"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region
}

module "ses" {
  source = "../app/ses-email"

  stage      = var.stage
  account_id = var.account_id
}
