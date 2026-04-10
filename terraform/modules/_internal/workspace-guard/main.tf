################################################################################
# Workspace Guard
#
# Prevents applying the wrong var file to the wrong Terraform workspace.
# Every tier (foundation, data, app) should consume this module.
#
# History: on 2026-04-05, running `terraform apply -var-file=prod.tfvars` in
# the dev workspace destroyed dev infrastructure. This guard prevents that
# class of incident by failing the plan before any damage occurs.
################################################################################

variable "stage" {
  description = "The deployment stage (must match the Terraform workspace name)"
  type        = string
}

resource "null_resource" "workspace_guard" {
  triggers = {
    stage     = var.stage
    workspace = terraform.workspace
  }

  lifecycle {
    precondition {
      condition     = var.stage == terraform.workspace
      error_message = "SAFETY: stage '${var.stage}' does not match workspace '${terraform.workspace}'. You are applying the wrong var file!"
    }
  }
}
