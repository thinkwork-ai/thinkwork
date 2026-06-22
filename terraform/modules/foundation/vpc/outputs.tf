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

output "public_route_table_ids" {
  description = "IDs of the public route tables (created or existing)"
  value       = local.public_route_table_ids
}

output "private_route_table_ids" {
  description = "IDs of the private route tables (created or existing)"
  value       = local.private_route_table_ids
}

output "nat_gateway_id" {
  description = "NAT Gateway ID when enable_nat_gateway is true and route tables are available"
  value       = local.nat_gateway_enabled ? aws_nat_gateway.main[0].id : null
}
