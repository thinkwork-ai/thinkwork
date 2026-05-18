# thinkwork-managed: enterprise-deploy-template
bucket         = "{{CUSTOMER_SLUG}}-thinkwork-terraform-state"
key            = "thinkwork/{{STAGE}}/terraform.tfstate"
region         = "{{REGION}}"
dynamodb_table = "{{CUSTOMER_SLUG}}-thinkwork-terraform-locks"
encrypt        = true
