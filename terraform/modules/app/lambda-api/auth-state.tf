################################################################################
# THINK-643/644 — DynamoDB short-lived state store
#
# `auth_subscription_tickets` in Aurora is pure churn: 60-second single-use
# AppSync tickets, plus the per-principal connect counter that backstops a
# looping client. One customer stage accumulated 551k rows of it on the primary
# database. DynamoDB is the right shape — native TTL sweeps expired items with
# no vacuum pressure, conditional writes give the same single-use guarantee the
# `status = 'issued'` predicate gave, and the table is reachable from the
# non-VPC auth Lambdas.
#
# THINK-644 widens the same table to webhook idempotency receipts, which have
# the identical defect in a different table: `webhook_idempotency` has no
# retention at all — a row survives until its parent webhook is deleted — so a
# chatty provider grows Aurora forever for records nobody reads after a day.
#
# Ship-inert: the table and its IAM grant are count-gated on
# var.auth_state_store == "dynamo", so a stage that has not flipped the flag
# plans to ZERO changes from this file.
################################################################################

locals {
  auth_state_enabled    = var.auth_state_store == "dynamo"
  auth_state_count      = local.auth_state_enabled ? 1 : 0
  auth_state_table_name = "thinkwork-${var.stage}-auth-state"
}

resource "aws_dynamodb_table" "auth_state" {
  count = local.auth_state_count

  name         = local.auth_state_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  # Epoch seconds. Tickets set this to their own expiry plus an hour of grace
  # so a replay still finds the consumed tombstone (TTL deletion is best-effort
  # and can lag by up to 48h); rate-limit counters set it to two window widths;
  # webhook idempotency receipts (THINK-644) set it to 7 days, comfortably past
  # any real provider's retry window. Because deletion lags, every reader
  # compares expires_at itself rather than trusting an item's presence.
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  # Deliberately OFF. Every item in this table is auth-flow scratch with a
  # lifetime measured in minutes — a point-in-time restore of it would restore
  # nothing anyone can use, and PITR bills continuously against the write churn
  # this table exists to absorb.
  point_in_time_recovery {
    enabled = false
  }

  tags = {
    Name    = local.auth_state_table_name
    Purpose = "auth-flow-state"
  }
}
