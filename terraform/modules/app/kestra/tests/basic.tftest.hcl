mock_provider "aws" {}

run "basic_kestra_module_plan" {
  command = plan

  variables {
    stage                      = "test"
    vpc_id                     = "vpc-1234567890abcdef0"
    subnet_ids                 = ["subnet-1234567890abcdef0", "subnet-abcdef1234567890a"]
    db_security_group_id       = "sg-1234567890abcdef0"
    db_host                    = "postgres.example.internal"
    db_name                    = "kestra"
    db_username                = "kestra"
    db_password_secret_arn     = "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-db"
    basic_auth_secret_arn      = "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-basic-auth"
    public_url                 = "https://orchestrate.example.com"
    certificate_arn            = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
    image_uri                  = "public.ecr.aws/thinkwork/kestra@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    storage_bucket_name        = "thinkwork-test-kestra-storage"
    wait_for_steady_state      = false
    storage_force_destroy      = true
    allowed_public_cidr_blocks = ["203.0.113.0/24"]
  }
}

run "parked_kestra_keeps_retained_resources" {
  command = plan

  variables {
    stage                  = "test"
    vpc_id                 = "vpc-1234567890abcdef0"
    subnet_ids             = ["subnet-1234567890abcdef0"]
    db_security_group_id   = "sg-1234567890abcdef0"
    db_host                = "postgres.example.internal"
    db_password_secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-db"
    basic_auth_secret_arn  = "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-basic-auth"
    public_url             = "https://orchestrate.example.com"
    certificate_arn        = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
    image_uri              = "public.ecr.aws/thinkwork/kestra@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    storage_bucket_name    = "thinkwork-test-kestra-storage"
    runtime_enabled        = false
    wait_for_steady_state  = false
  }

  assert {
    condition     = aws_ecs_service.kestra.desired_count == 0
    error_message = "parking Kestra should set the ECS service desired count to zero."
  }

  assert {
    condition     = aws_s3_bucket.kestra.bucket == "thinkwork-test-kestra-storage"
    error_message = "parking Kestra should retain the internal storage bucket."
  }
}

run "rejects_mutable_image" {
  command = plan

  variables {
    stage                  = "test"
    vpc_id                 = "vpc-1234567890abcdef0"
    subnet_ids             = ["subnet-1234567890abcdef0"]
    db_security_group_id   = "sg-1234567890abcdef0"
    db_host                = "postgres.example.internal"
    db_password_secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-db"
    basic_auth_secret_arn  = "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-basic-auth"
    public_url             = "https://orchestrate.example.com"
    certificate_arn        = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
    image_uri              = "public.ecr.aws/thinkwork/kestra:latest"
    storage_bucket_name    = "thinkwork-test-kestra-storage"
    wait_for_steady_state  = false
  }

  expect_failures = [var.image_uri]
}

run "requires_secret_references_or_placeholders" {
  command = plan

  variables {
    stage                 = "test"
    vpc_id                = "vpc-1234567890abcdef0"
    subnet_ids            = ["subnet-1234567890abcdef0"]
    db_security_group_id  = "sg-1234567890abcdef0"
    db_host               = "postgres.example.internal"
    public_url            = "https://orchestrate.example.com"
    certificate_arn       = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
    image_uri             = "public.ecr.aws/thinkwork/kestra@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    storage_bucket_name   = "thinkwork-test-kestra-storage"
    wait_for_steady_state = false
  }

  expect_failures = [terraform_data.configuration_guardrails]
}
