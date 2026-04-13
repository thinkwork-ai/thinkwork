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

  # Hindsight is an optional add-on. Preferred toggle: var.enable_hindsight.
  # For one release we also honor the deprecated var.memory_engine == "hindsight"
  # so existing tfvars keep working. The CLI config command also auto-translates
  # between the two. Remove the legacy branch in a future release.
  hindsight_enabled = var.enable_hindsight || var.memory_engine == "hindsight"
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

  create_cognito            = var.create_cognito
  existing_user_pool_id     = var.existing_user_pool_id
  existing_user_pool_arn    = var.existing_user_pool_arn
  existing_admin_client_id  = var.existing_admin_client_id
  existing_mobile_client_id = var.existing_mobile_client_id
  existing_identity_pool_id = var.existing_identity_pool_id

  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  pre_signup_lambda_zip      = var.pre_signup_lambda_zip

  admin_callback_urls = concat(
    var.admin_callback_urls,
    ["https://${module.admin_site.distribution_domain}", "https://${module.admin_site.distribution_domain}/auth/callback"]
  )
  admin_logout_urls = concat(
    var.admin_logout_urls,
    ["https://${module.admin_site.distribution_domain}"]
  )
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

  stage = var.stage

  create_database               = var.create_database
  existing_db_cluster_arn       = var.existing_db_cluster_arn
  existing_db_secret_arn        = var.existing_db_secret_arn
  existing_db_endpoint          = var.existing_db_endpoint
  existing_db_security_group_id = var.existing_db_security_group_id

  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.public_subnet_ids
  db_password = var.db_password

  database_name   = var.database_name
  database_engine = var.database_engine
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

# Subscription-only schema for AppSync — typed event payloads (from schema:build)
locals {
  subscription_schema = file("${path.module}/../../schema.graphql")
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
  db_cluster_endpoint   = module.database.cluster_endpoint
  graphql_db_secret_arn = module.database.graphql_db_secret_arn
  database_name         = var.database_name

  bucket_name = module.s3.bucket_name
  bucket_arn  = module.s3.bucket_arn

  user_pool_id     = module.cognito.user_pool_id
  user_pool_arn    = module.cognito.user_pool_arn
  admin_client_id  = module.cognito.admin_client_id
  mobile_client_id = module.cognito.mobile_client_id

  appsync_api_url = module.appsync.graphql_api_url
  appsync_api_key = module.appsync.graphql_api_key

  kb_service_role_arn = module.bedrock_kb.kb_service_role_arn

  lambda_zips_dir         = var.lambda_zips_dir
  api_auth_secret         = var.api_auth_secret
  db_password             = var.db_password
  agentcore_function_name = module.agentcore.agentcore_function_name
  agentcore_function_arn  = module.agentcore.agentcore_function_arn
  hindsight_endpoint      = local.hindsight_enabled ? module.hindsight[0].hindsight_endpoint : ""
  agentcore_memory_id     = module.agentcore_memory.memory_id
  admin_url               = "https://${module.admin_site.distribution_domain}"
  docs_url                = "https://${module.docs_site.distribution_domain}"
  appsync_realtime_url    = module.appsync.graphql_realtime_url
  ecr_repository_url      = module.agentcore.ecr_repository_url
}

################################################################################
# AgentCore Memory (managed) — always created. Provides automatic per-turn
# retention via memory.store_turn_pair in the agent container. If the caller
# already has a memory resource, set `agentcore_memory_id` on the root module
# to short-circuit provisioning.
################################################################################

module "agentcore_memory" {
  source = "../app/agentcore-memory"

  stage              = var.stage
  region             = var.region
  account_id         = var.account_id
  existing_memory_id = var.agentcore_memory_id
}

module "agentcore" {
  source = "../app/agentcore-runtime"

  stage       = var.stage
  account_id  = var.account_id
  region      = var.region
  bucket_name = module.s3.bucket_name

  hindsight_endpoint  = local.hindsight_enabled ? module.hindsight[0].hindsight_endpoint : ""
  agentcore_memory_id = module.agentcore_memory.memory_id
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

module "hindsight" {
  count  = local.hindsight_enabled ? 1 : 0
  source = "../app/hindsight-memory"

  stage                = var.stage
  vpc_id               = module.vpc.vpc_id
  subnet_ids           = module.vpc.public_subnet_ids
  db_security_group_id = module.database.db_security_group_id
  database_url         = module.database.database_url
  image_tag            = var.hindsight_image_tag
}

module "ses" {
  source = "../app/ses-email"

  stage      = var.stage
  account_id = var.account_id
}

################################################################################
# Admin Static Site
################################################################################

module "admin_site" {
  source = "../app/static-site"

  stage     = var.stage
  site_name = "admin"
  is_spa    = true
}

################################################################################
# Docs Static Site
################################################################################

module "docs_site" {
  source = "../app/static-site"

  stage           = var.stage
  site_name       = "docs"
  custom_domain   = var.docs_domain
  certificate_arn = var.docs_certificate_arn
}
