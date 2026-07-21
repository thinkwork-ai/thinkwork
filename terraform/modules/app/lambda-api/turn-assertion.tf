# Signed-turn identity (THINK-324 Wave-3 C18).
#
# An asymmetric SIGN_VERIFY key per published version label. The dispatch
# Lambdas (chat-agent-invoke, wakeup-processor) mint a short-lived assertion
# binding {tenant, thread, turn} into the Pi invoke payload; the runtime
# echoes it on callbacks; verifiers (tool-executions today, more in C19)
# check the signature locally against the cached public key. The private key
# never leaves KMS — a compromised Lambda cannot exfiltrate the signer.
#
# The `agentcore_turn_assertion_*` variables predate this plane's rebuild
# (the THINK-311 trial's key was destroyed with the managed harness); the
# same one-or-two-version rotation contract applies.

resource "aws_kms_key" "agentcore_turn_assertion" {
  for_each = toset(var.agentcore_turn_assertion_key_versions)

  description              = "ThinkWork ${var.stage} signed-turn assertion key (${each.key})"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_NIST_P256"
  deletion_window_in_days  = 7

  lifecycle {
    precondition {
      condition     = contains(var.agentcore_turn_assertion_key_versions, var.agentcore_turn_assertion_active_key_version)
      error_message = "agentcore_turn_assertion_active_key_version must be one of agentcore_turn_assertion_key_versions."
    }
  }

  tags = {
    Stage     = var.stage
    Component = "turn-assertion"
  }
}

resource "aws_kms_alias" "agentcore_turn_assertion" {
  for_each = toset(var.agentcore_turn_assertion_key_versions)

  name          = "alias/thinkwork-${var.stage}-turn-assertion-${each.key}"
  target_key_id = aws_kms_key.agentcore_turn_assertion[each.key].key_id
}

locals {
  turn_assertion_active_key_arn = aws_kms_key.agentcore_turn_assertion[var.agentcore_turn_assertion_active_key_version].arn
  turn_assertion_key_arns       = [for key in aws_kms_key.agentcore_turn_assertion : key.arn]
}
