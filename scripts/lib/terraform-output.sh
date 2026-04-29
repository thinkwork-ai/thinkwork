#!/usr/bin/env bash

strip_terraform_output_noise() {
  perl -0pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g; s/\r//g; s/[[:space:]]*╷.*//s; s/[[:space:]]+Warning: .*//s; s/[[:space:]]+\z//'
}

tf_output_raw() {
  local name="${1:?terraform output name required}"
  local status
  local value

  value="$(terraform output -no-color -raw "$name" 2>&1)"
  status=$?
  if [[ $status -ne 0 ]]; then
    printf '%s\n' "$value" >&2
    return "$status"
  fi

  printf '%s' "$value" | strip_terraform_output_noise
}
