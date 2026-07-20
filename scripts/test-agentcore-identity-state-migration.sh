#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$repo_root/terraform/modules/app/agentcore-identity/tests/tainted-marker"
terraform_bin="${TERRAFORM_BINARY:-terraform}"
version="$($terraform_bin version -json | jq -r '.terraform_version')"

if [[ "$version" != "1.8.5" ]]; then
  echo "AgentCore identity state migration fixture requires Terraform 1.8.5, got $version" >&2
  exit 64
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/thinkwork-agentcore-state-migration.XXXXXX")"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

cp "$fixture/before.tf" "$work/main.tf"
mkdir -p "$work/thinkwork/agentcore-identity"
cp "$fixture/thinkwork-before.tf" "$work/thinkwork/main.tf"
cp "$fixture/identity-before.tf" "$work/thinkwork/agentcore-identity/main.tf"
(
  cd "$work"
  "$terraform_bin" init -backend=false -input=false -no-color >/dev/null
  "$terraform_bin" apply -auto-approve -input=false -no-color >/dev/null
  "$terraform_bin" taint -no-color \
    'module.thinkwork.module.agentcore_proof_identity.terraform_data.twenty_identity_lifecycle[0]' \
    >/dev/null
  cp "$fixture/after.tf" main.tf
  cp "$fixture/thinkwork-after.tf" thinkwork/main.tf
  cp "$fixture/identity-after.tf" thinkwork/agentcore-identity/main.tf
  "$terraform_bin" plan -out=tfplan -input=false -no-color >/dev/null
  "$terraform_bin" show -json tfplan >plan.json
)

old_actions="$(jq -c '
  .resource_changes[]
  | select(.address == "module.thinkwork.module.agentcore_proof_identity.terraform_data.twenty_identity_lifecycle[0]")
  | .change.actions
' "$work/plan.json")"
new_actions="$(jq -c '
  .resource_changes[]
  | select(.address == "module.thinkwork.module.agentcore_proof_identity.terraform_data.twenty_identity_reconciliation[0]")
  | .change.actions
' "$work/plan.json")"

if [[ "$old_actions" != '["forget"]' ]]; then
  echo "Expected the tainted legacy marker to be forgotten, got $old_actions" >&2
  exit 1
fi
if [[ "$new_actions" != '["create"]' ]]; then
  echo "Expected the reconciliation marker to be created, got $new_actions" >&2
  exit 1
fi
if jq -e '.resource_changes[].change.actions | index("delete")' "$work/plan.json" >/dev/null; then
  echo "State migration plan contains a delete action" >&2
  exit 1
fi
if jq -e '
  .resource_changes[]
  | select(.address | contains("twenty_identity_cleanup_owner"))
  | .change.actions
  | select(. != ["no-op"])
' "$work/plan.json" >/dev/null; then
  echo "Stable cleanup owner changed during state-only migration" >&2
  exit 1
fi
if [[ -e "$work/destroyed.log" ]]; then
  echo "Legacy destroy provisioner ran during plan" >&2
  exit 1
fi

(
  cd "$work"
  "$terraform_bin" apply -auto-approve -input=false -no-color tfplan >/dev/null
)
if [[ -e "$work/destroyed.log" ]]; then
  echo "Legacy destroy provisioner ran while forgetting state" >&2
  exit 1
fi
if [[ ! -s "$work/reconciled.log" ]]; then
  echo "New idempotent reconciliation provisioner did not run" >&2
  exit 1
fi

echo "Terraform 1.8.5 tainted-marker migration: forget + create, zero delete"
