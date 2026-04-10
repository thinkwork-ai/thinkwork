output "vpc_id" {
  description = "ID of the VPC (created or existing)"
  value       = local.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets (created or existing)"
  value       = local.public_subnet_ids
}

output "private_subnet_ids" {
  description = "IDs of the private subnets (created or existing)"
  value       = local.private_subnet_ids
}
