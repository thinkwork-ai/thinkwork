terraform {
  required_version = "= 1.8.5"
}

removed {
  from = module.thinkwork.module.agentcore_proof_identity.terraform_data.twenty_identity_lifecycle

  lifecycle {
    destroy = false
  }
}

module "thinkwork" {
  source = "./thinkwork"
}
