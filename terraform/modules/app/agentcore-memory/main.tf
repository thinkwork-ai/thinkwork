################################################################################
# AgentCore Memory — App Module
#
# Provisions an AWS Bedrock AgentCore Memory resource with the four strategies
# the Strands agent container expects (semantic, preferences, summaries,
# episodes). The resource is always created — AgentCore managed memory is
# on by default so every agent gets automatic per-turn retention into
# semantic / preference / summary / episode strategies without any tool-
# calling by the model.
#
# **Why not a first-class resource?** The AWS provider does not (yet) expose a
# `aws_bedrockagentcore_memory` resource type. Until it does, we drive the
# create/find/destroy lifecycle through the `aws bedrock-agentcore-control`
# CLI via a small shell script, and read the resulting memory ID back into
# Terraform via `data "external"`. The script is idempotent — it lists
# existing memories with the same name and returns the existing ID if found,
# which keeps `terraform apply` safe to re-run.
#
# **BYO override:** If you already have an AgentCore Memory resource, set
# `var.existing_memory_id` to skip provisioning. The module output will echo
# that ID directly and no CLI calls are made.
################################################################################

terraform {
  required_providers {
    external = {
      source  = "hashicorp/external"
      version = ">= 2.3.0"
    }
  }
}

variable "stage" {
  description = "Deployment stage (dev, prod, etc.) — used to name the memory resource"
  type        = string
}

variable "name_prefix" {
  description = "Prefix for the Bedrock AgentCore Memory resource name"
  type        = string
  default     = "thinkwork"
}

variable "existing_memory_id" {
  description = "Optional pre-existing AgentCore Memory ID. When set, the module skips provisioning and passes this ID through."
  type        = string
  default     = ""
}

variable "region" {
  description = "AWS region"
  type        = string
}

locals {
  memory_name = "${replace(var.name_prefix, "-", "_")}_${replace(var.stage, "-", "_")}"
  bootstrap   = var.existing_memory_id == ""
}

################################################################################
# Create-or-find via shell script (only when no existing_memory_id was given).
#
# The script produces JSON: `{"memory_id": "..."}`. Terraform re-runs it on
# every plan — if the memory already exists, the script returns the same ID
# without side effects. Inputs are passed as JSON on stdin; outputs MUST be
# a single JSON object on stdout for `data "external"` to parse.
################################################################################

data "external" "memory" {
  count   = local.bootstrap ? 1 : 0
  program = ["bash", "${path.module}/scripts/create_or_find_memory.sh"]

  query = {
    name   = local.memory_name
    region = var.region
  }
}

################################################################################
# Destroy-time cleanup
#
# Terraform's `data "external"` has no destroy hook, so we use a paired
# `terraform_data` resource with a destroy-time local-exec that deletes the
# memory by ID. `triggers_replace` binds the resource to the memory ID so
# that replacing one memory correctly destroys the old one.
################################################################################

resource "terraform_data" "memory_lifecycle" {
  count = local.bootstrap ? 1 : 0

  input = {
    memory_id = data.external.memory[0].result.memory_id
    region    = var.region
  }

  triggers_replace = [
    local.memory_name,
    var.region,
  ]

  provisioner "local-exec" {
    when    = destroy
    command = "aws bedrock-agentcore-control delete-memory --region ${self.output.region} --memory-id ${self.output.memory_id} || echo 'delete-memory failed (may already be gone)'"
  }
}

################################################################################
# Outputs
################################################################################

output "memory_id" {
  description = "Bedrock AgentCore Memory resource ID — passed into the agent container as AGENTCORE_MEMORY_ID"
  value       = local.bootstrap ? data.external.memory[0].result.memory_id : var.existing_memory_id
}

output "memory_name" {
  description = "Logical name used for the memory resource"
  value       = local.memory_name
}
