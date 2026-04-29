#!/usr/bin/env bash

tf_output_raw() {
  local name="${1:?terraform output name required}"
  local value

  value="$(terraform output -no-color -raw "$name" 2>/dev/null || true)"
  printf '%s' "$value" | perl -0pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g; s/╷.*//s; s/[[:space:]]+\z//'
}
