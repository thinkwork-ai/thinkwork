# thinkwork-managed: enterprise-deploy-template

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.region
}

provider "cloudflare" {}

variable "stage" {
  description = "Deployment stage. Must match the selected Terraform workspace."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "account_id" {
  description = "Customer AWS account ID."
  type        = string
}

variable "db_password" {
  description = "Aurora master password. Set through the GitHub Environment secret TF_VAR_DB_PASSWORD."
  type        = string
  sensitive   = true
}

variable "api_auth_secret" {
  description = "Shared service API secret. Set through the GitHub Environment secret TF_VAR_API_AUTH_SECRET."
  type        = string
  sensitive   = true
}

variable "database_engine" {
  description = "Database engine for this stage."
  type        = string
  default     = "aurora-serverless"
}

variable "enable_cognee" {
  description = "Enable Cognee as an optional ontology/knowledge-graph add-on. Disabled by default."
  type        = bool
  default     = false
}

variable "cognee_image_uri" {
  description = "Cognee container image URI pinned to an immutable sha256 digest. Required when enable_cognee = true."
  type        = string
  default     = ""
}

variable "cognee_db_username" {
  description = "Dedicated PostgreSQL username for Cognee metadata storage."
  type        = string
  default     = "thinkwork_cognee"
}

variable "cognee_db_name" {
  description = "Dedicated PostgreSQL database name for Cognee metadata storage."
  type        = string
  default     = "thinkwork_cognee"
}

variable "cognee_db_password_secret_arn" {
  description = "Secrets Manager ARN containing a JSON password field for the dedicated Cognee PostgreSQL user. Required when enable_cognee = true."
  type        = string
  default     = ""
}

variable "cognee_allowed_internal_cidr_blocks" {
  description = "CIDR blocks allowed to reach the internal Cognee ALB."
  type        = list(string)
  default     = []
}

variable "cognee_allowed_internal_security_group_ids" {
  description = "Security group IDs allowed to reach the internal Cognee ALB."
  type        = list(string)
  default     = []
}

variable "cognee_backend_mode" {
  description = "Cognee backend mode. dogfood uses EFS-backed local stores; remote requires graph/vector URLs."
  type        = string
  default     = "dogfood"
}

variable "cognee_desired_count" {
  description = "Desired Cognee task count. Dogfood mode must stay at 1."
  type        = number
  default     = 1
}

variable "cognee_llm_provider" {
  description = "Cognee LLM provider."
  type        = string
  default     = "bedrock"
}

variable "cognee_llm_model" {
  description = "Cognee LLM model."
  type        = string
  default     = "bedrock/amazon.nova-lite-v1:0"
}

variable "cognee_llm_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for non-Bedrock Cognee LLM provider API key."
  type        = string
  default     = ""
}

variable "cognee_embedding_provider" {
  description = "Cognee embedding provider."
  type        = string
  default     = "bedrock"
}

variable "cognee_embedding_model" {
  description = "Cognee embedding model."
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "cognee_embedding_dimensions" {
  description = "Cognee embedding dimensions."
  type        = number
  default     = 1024
}

variable "cognee_embedding_api_key_secret_arn" {
  description = "Optional Secrets Manager ARN for non-Bedrock Cognee embedding provider API key."
  type        = string
  default     = ""
}

variable "cognee_vector_db_provider" {
  description = "Cognee vector store provider."
  type        = string
  default     = "lancedb"
}

variable "cognee_vector_db_url" {
  description = "Cognee vector store URL. Empty uses the dogfood local default."
  type        = string
  default     = ""
}

variable "cognee_vector_db_key_secret_arn" {
  description = "Optional Secrets Manager ARN for remote Cognee vector store credentials."
  type        = string
  default     = ""
}

variable "cognee_graph_database_provider" {
  description = "Cognee graph store provider."
  type        = string
  default     = "kuzu"
}

variable "cognee_graph_database_url" {
  description = "Cognee graph store URL. Empty uses the dogfood local default."
  type        = string
  default     = ""
}

variable "cognee_graph_database_username" {
  description = "Optional Cognee graph store username."
  type        = string
  default     = ""
}

variable "cognee_graph_database_password_secret_arn" {
  description = "Optional Secrets Manager ARN for remote Cognee graph store password."
  type        = string
  default     = ""
}

variable "cognee_bedrock_model_resource_arns" {
  description = "Explicit Bedrock model ARNs Cognee may invoke when a Bedrock provider is selected."
  type        = list(string)
  default     = []
}

variable "cognee_kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt Cognee-injected secrets."
  type        = list(string)
  default     = []
}

variable "twenty_provisioned" {
  description = "Provision the retained Twenty CRM managed-app substrate. Runtime can be parked independently with twenty_runtime_enabled."
  type        = bool
  default     = false
}

variable "twenty_runtime_enabled" {
  description = "Run Twenty CRM server/worker tasks when the retained substrate is provisioned."
  type        = bool
  default     = false
}

variable "twenty_image_uri" {
  description = "Twenty CRM container image URI pinned to an immutable sha256 digest. Required when twenty_provisioned = true."
  type        = string
  default     = ""
}

variable "twenty_db_username" {
  description = "Dedicated PostgreSQL username for Twenty CRM."
  type        = string
  default     = "thinkwork_twenty"
}

variable "twenty_db_name" {
  description = "Dedicated PostgreSQL database name for Twenty CRM."
  type        = string
  default     = "thinkwork_twenty"
}

variable "twenty_db_url_secret_arn" {
  description = "Secrets Manager ARN containing a JSON PG_DATABASE_URL field for the dedicated Twenty database. Required when twenty_provisioned = true."
  type        = string
  default     = ""
}

variable "twenty_encryption_key_secret_arn" {
  description = "Secrets Manager ARN containing a JSON ENCRYPTION_KEY field for Twenty. Required when twenty_provisioned = true."
  type        = string
  default     = ""
}

variable "twenty_email_from_address" {
  description = "Verified SES sender address for Twenty app emails. Leave empty to derive noreply@ses_inbound_domain."
  type        = string
  default     = ""
}

variable "twenty_email_from_name" {
  description = "Display name for Twenty app email From headers."
  type        = string
  default     = "ThinkWork CRM"
}

variable "twenty_public_url" {
  description = "Public HTTPS URL for Twenty CRM. Leave empty to derive https://crm.<www_domain>."
  type        = string
  default     = ""
}

variable "twenty_certificate_arn" {
  description = "ACM certificate ARN for the Twenty public ALB. Leave empty to reuse the www-dns certificate."
  type        = string
  default     = ""
}

variable "kestra_provisioned" {
  description = "Provision the retained Kestra managed-app substrate. Runtime can be parked independently with kestra_runtime_enabled."
  type        = bool
  default     = false
}

variable "kestra_runtime_enabled" {
  description = "Run the Kestra service when the retained substrate is provisioned."
  type        = bool
  default     = false
}

variable "kestra_image_uri" {
  description = "Kestra container image URI pinned to an immutable sha256 digest. Required when kestra_provisioned = true."
  type        = string
  default     = ""
}

variable "kestra_db_username" {
  description = "Dedicated PostgreSQL username for Kestra."
  type        = string
  default     = "thinkwork_kestra"
}

variable "kestra_db_name" {
  description = "Dedicated PostgreSQL database name for Kestra."
  type        = string
  default     = "thinkwork_kestra"
}

variable "kestra_db_password_secret_arn" {
  description = "Secrets Manager ARN containing a JSON password field for the dedicated Kestra database user. Required when kestra_provisioned = true."
  type        = string
  default     = ""
}

variable "kestra_basic_auth_secret_arn" {
  description = "Secrets Manager ARN containing JSON username/password fields for the Kestra UI/API service credential. Required when kestra_provisioned = true."
  type        = string
  default     = ""
}

variable "kestra_public_url" {
  description = "Public HTTPS URL for Kestra. Leave empty to derive from the composite module's Kestra domain settings."
  type        = string
  default     = ""
}

variable "kestra_certificate_arn" {
  description = "ACM certificate ARN for the Kestra public ALB. Required unless the composite module receives a www certificate ARN."
  type        = string
  default     = ""
}

variable "kestra_desired_count" {
  description = "Desired Kestra standalone task count when kestra_runtime_enabled is true."
  type        = number
  default     = 1
}

variable "kestra_storage_bucket_name" {
  description = "Optional explicit S3 bucket name for Kestra internal storage."
  type        = string
  default     = ""
}

variable "kestra_storage_force_destroy" {
  description = "Whether Terraform may delete non-empty Kestra internal storage buckets during destroy. Enable only for explicitly approved destructive teardown."
  type        = bool
  default     = false
}

variable "kestra_allowed_public_cidr_blocks" {
  description = "CIDR blocks allowed to reach the public Kestra HTTPS ALB."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "kestra_kms_key_arns" {
  description = "Optional KMS key ARNs needed to decrypt Kestra-injected secrets."
  type        = list(string)
  default     = []
}

variable "lambda_artifact_bucket" {
  description = "Customer-owned S3 bucket containing pinned ThinkWork Lambda release artifacts."
  type        = string
}

variable "lambda_artifact_prefix" {
  description = "S3 prefix for the pinned ThinkWork Lambda release artifacts."
  type        = string
}

module "thinkwork" {
  source  = "thinkwork-ai/thinkwork/aws"
  version = "{{TERRAFORM_MODULE_VERSION}}"

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  database_engine = var.database_engine
  db_password     = var.db_password
  api_auth_secret = var.api_auth_secret

  enable_cognee                              = var.enable_cognee
  cognee_image_uri                           = var.cognee_image_uri
  cognee_db_username                         = var.cognee_db_username
  cognee_db_name                             = var.cognee_db_name
  cognee_db_password_secret_arn              = var.cognee_db_password_secret_arn
  cognee_allowed_internal_cidr_blocks        = var.cognee_allowed_internal_cidr_blocks
  cognee_allowed_internal_security_group_ids = var.cognee_allowed_internal_security_group_ids
  cognee_backend_mode                        = var.cognee_backend_mode
  cognee_desired_count                       = var.cognee_desired_count
  cognee_llm_provider                        = var.cognee_llm_provider
  cognee_llm_model                           = var.cognee_llm_model
  cognee_llm_api_key_secret_arn              = var.cognee_llm_api_key_secret_arn
  cognee_embedding_provider                  = var.cognee_embedding_provider
  cognee_embedding_model                     = var.cognee_embedding_model
  cognee_embedding_dimensions                = var.cognee_embedding_dimensions
  cognee_embedding_api_key_secret_arn        = var.cognee_embedding_api_key_secret_arn
  cognee_vector_db_provider                  = var.cognee_vector_db_provider
  cognee_vector_db_url                       = var.cognee_vector_db_url
  cognee_vector_db_key_secret_arn            = var.cognee_vector_db_key_secret_arn
  cognee_graph_database_provider             = var.cognee_graph_database_provider
  cognee_graph_database_url                  = var.cognee_graph_database_url
  cognee_graph_database_username             = var.cognee_graph_database_username
  cognee_graph_database_password_secret_arn  = var.cognee_graph_database_password_secret_arn
  cognee_bedrock_model_resource_arns         = var.cognee_bedrock_model_resource_arns
  cognee_kms_key_arns                        = var.cognee_kms_key_arns
  twenty_provisioned                         = var.twenty_provisioned
  twenty_runtime_enabled                     = var.twenty_runtime_enabled
  twenty_image_uri                           = var.twenty_image_uri
  twenty_db_username                         = var.twenty_db_username
  twenty_db_name                             = var.twenty_db_name
  twenty_db_url_secret_arn                   = var.twenty_db_url_secret_arn
  twenty_encryption_key_secret_arn           = var.twenty_encryption_key_secret_arn
  twenty_email_from_address                  = var.twenty_email_from_address
  twenty_email_from_name                     = var.twenty_email_from_name
  twenty_public_url                          = var.twenty_public_url
  twenty_certificate_arn                     = var.twenty_certificate_arn
  kestra_provisioned                         = var.kestra_provisioned
  kestra_runtime_enabled                     = var.kestra_runtime_enabled
  kestra_image_uri                           = var.kestra_image_uri
  kestra_db_username                         = var.kestra_db_username
  kestra_db_name                             = var.kestra_db_name
  kestra_db_password_secret_arn              = var.kestra_db_password_secret_arn
  kestra_basic_auth_secret_arn               = var.kestra_basic_auth_secret_arn
  kestra_public_url                          = var.kestra_public_url
  kestra_certificate_arn                     = var.kestra_certificate_arn
  kestra_desired_count                       = var.kestra_desired_count
  kestra_storage_bucket_name                 = var.kestra_storage_bucket_name
  kestra_storage_force_destroy               = var.kestra_storage_force_destroy
  kestra_allowed_public_cidr_blocks          = var.kestra_allowed_public_cidr_blocks
  kestra_kms_key_arns                        = var.kestra_kms_key_arns

  lambda_artifact_bucket   = var.lambda_artifact_bucket
  lambda_artifact_prefix   = var.lambda_artifact_prefix
  require_lambda_artifacts = true
}

output "api_endpoint" {
  value = module.thinkwork.api_endpoint
}

output "lambda_artifact_mode" {
  value = module.thinkwork.lambda_artifact_mode
}

output "cognee_enabled" {
  value = module.thinkwork.cognee_enabled
}

output "cognee_endpoint" {
  value = module.thinkwork.cognee_endpoint
}

output "twenty_provisioned" {
  value = module.thinkwork.twenty_provisioned
}

output "twenty_runtime_enabled" {
  value = module.thinkwork.twenty_runtime_enabled
}

output "twenty_url" {
  value = module.thinkwork.twenty_url
}

output "kestra_provisioned" {
  value = module.thinkwork.kestra_provisioned
}

output "kestra_runtime_enabled" {
  value = module.thinkwork.kestra_runtime_enabled
}

output "kestra_url" {
  value = module.thinkwork.kestra_url
}

output "kestra_service_name" {
  value = module.thinkwork.kestra_service_name
}

output "kestra_log_group_name" {
  value = module.thinkwork.kestra_log_group_name
}

output "kestra_storage_bucket_name" {
  value = module.thinkwork.kestra_storage_bucket_name
}
