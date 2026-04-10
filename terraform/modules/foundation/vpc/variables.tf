variable "stage" {
  description = "Deployment stage (e.g. dev, prod)"
  type        = string
}

variable "create_vpc" {
  description = "Whether to create a new VPC. Set to false and provide existing_vpc_id to use an existing VPC."
  type        = bool
  default     = true
}

variable "existing_vpc_id" {
  description = "ID of an existing VPC to use (required when create_vpc = false)"
  type        = string
  default     = null
}

variable "existing_public_subnet_ids" {
  description = "IDs of existing public subnets (required when create_vpc = false)"
  type        = list(string)
  default     = []
}

variable "existing_private_subnet_ids" {
  description = "IDs of existing private subnets (required when create_vpc = false)"
  type        = list(string)
  default     = []
}

variable "cidr_block" {
  description = "CIDR block for the VPC (only used when create_vpc = true)"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones for subnets (only used when create_vpc = true)"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}
