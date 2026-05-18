################################################################################
# Lambda Release Artifact Sources
#
# Source-repo deploys build zips locally and sets var.lambda_zips_dir.
# Enterprise deployment repos upload release zips to a customer-owned S3 bucket
# and set var.lambda_artifact_bucket + var.lambda_artifact_prefix.
################################################################################

locals {
  use_remote_lambda_artifacts  = trimspace(var.lambda_artifact_bucket) != ""
  lambda_artifact_prefix       = trim(trimspace(var.lambda_artifact_prefix), "/")
  lambda_artifact_source_count = (local.use_local_zips ? 1 : 0) + (local.use_remote_lambda_artifacts ? 1 : 0)
  deploy_lambda_handlers       = local.lambda_artifact_source_count == 1
  lambda_artifact_mode         = local.use_local_zips ? "local" : local.use_remote_lambda_artifacts ? "s3" : "placeholder"
}

resource "terraform_data" "lambda_artifact_validation" {
  input = local.lambda_artifact_mode

  lifecycle {
    precondition {
      condition     = local.lambda_artifact_source_count <= 1
      error_message = "Set only one Lambda artifact source: lambda_zips_dir for source checkouts, or lambda_artifact_bucket/lambda_artifact_prefix for release artifacts."
    }

    precondition {
      condition     = !local.use_remote_lambda_artifacts || local.lambda_artifact_prefix != ""
      error_message = "lambda_artifact_prefix must be set when lambda_artifact_bucket is set."
    }

    precondition {
      condition     = !var.require_lambda_artifacts || local.deploy_lambda_handlers
      error_message = "require_lambda_artifacts=true requires either lambda_zips_dir or lambda_artifact_bucket/lambda_artifact_prefix."
    }
  }
}
