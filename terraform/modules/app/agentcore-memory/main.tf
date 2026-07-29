################################################################################
# AgentCore Memory — App Module
#
# Provisions an AWS Bedrock AgentCore Memory resource with the four strategies
# the ThinkWork AgentCore runtime expects (semantic, preferences, summaries,
# episodes). The resource is always created — AgentCore managed memory is
# on by default so every agent gets automatic per-turn retention into
# semantic / preference / summary / episode strategies without any tool-
# calling by the model.
#
# **Why not a first-class resource?** The AWS provider does not (yet) expose a
# `aws_bedrockagentcore_memory` resource type. Until it does, we drive the
# ensure/destroy lifecycle through the `aws bedrock-agentcore-control`
# CLI via a small shell script, and read the resulting memory ID back into
# Terraform via `data "external"`.
#
# **Self-healing.** The script is an *ensure*, not a one-shot create: it
# probes the live resource on every plan and every apply, and recreates it
# when it has gone missing. That matters because Terraform state can hold a
# memory ID whose resource was deleted out-of-band (THINK-404 found dev in
# exactly that state — SSM advertised a memory ID that GetMemory 404'd on,
# and nothing in the module ever re-checked). The module output therefore
# reflects the memory that actually exists right now, not the one state
# remembers.
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

variable "account_id" {
  description = "AWS account ID"
  type        = string
  default     = ""
}

locals {
  memory_name = "${replace(var.name_prefix, "-", "_")}_${replace(var.stage, "-", "_")}"
  bootstrap   = var.existing_memory_id == ""
}

################################################################################
# IAM Role for custom memory strategies
################################################################################

resource "aws_iam_role" "memory_execution" {
  count = local.bootstrap ? 1 : 0
  name  = "thinkwork-${var.stage}-memory-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "memory_execution" {
  count = local.bootstrap ? 1 : 0
  name  = "memory-execution"
  role  = aws_iam_role.memory_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "arn:aws:bedrock:${var.region}::foundation-model/*"
    }]
  })
}

################################################################################
# Ensure via shell script (only when no existing_memory_id was given).
#
# The script produces JSON: `{"memory_id": "..."}`. Terraform re-runs it on
# every plan — if an ACTIVE memory with this name already exists, the script
# returns that same ID and only drift-corrects its strategy list; if the
# memory is missing, unresolvable, or DELETING/FAILED, the script creates a
# replacement and waits for it to reach ACTIVE. It never deletes anything.
# Inputs are passed as JSON on stdin; outputs MUST be a single JSON object
# on stdout for `data "external"` to parse.
################################################################################

data "external" "memory" {
  count   = local.bootstrap ? 1 : 0
  program = ["bash", "${path.module}/scripts/create_or_find_memory.sh"]

  query = {
    name               = local.memory_name
    region             = var.region
    execution_role_arn = aws_iam_role.memory_execution[0].arn
  }
}

################################################################################
# Destroy-time cleanup
#
# Terraform's `data "external"` has no destroy hook, so we use a paired
# `terraform_data` resource with a destroy-time local-exec that deletes the
# memory by ID.
#
# `triggers_replace` is deliberately keyed on the memory *name* and region,
# NOT on the memory ID. Keying it on the ID would turn every self-heal (new
# ID for the same logical memory) into a replacement, firing the destroy
# provisioner against the ID the heal just recovered from — at best a no-op
# delete of an already-gone resource, at worst a delete of the freshly
# created one. Renaming or re-regioning the memory is a real replacement and
# still destroys the old resource; healing is an in-place `input` update.
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
