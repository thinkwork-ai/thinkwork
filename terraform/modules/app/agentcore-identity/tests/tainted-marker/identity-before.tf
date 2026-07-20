resource "terraform_data" "twenty_identity_lifecycle" {
  count = 1
  input = "legacy-state-only-marker"

  provisioner "local-exec" {
    when    = destroy
    command = "printf '%s\\n' destroyed > '${path.root}/destroyed.log'"
  }
}
