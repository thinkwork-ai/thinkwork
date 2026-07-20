resource "terraform_data" "twenty_identity_reconciliation" {
  count = 1
  input = "new-idempotent-reconciliation-marker"

  provisioner "local-exec" {
    command = "printf '%s\\n' reconciled > '${path.root}/reconciled.log'"
  }
}
