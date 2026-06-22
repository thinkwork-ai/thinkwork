################################################################################
# VPC — Foundation Module
#
# Creates a VPC with public and private subnets across two AZs,
# or accepts an existing VPC via BYO variables.
################################################################################

locals {
  vpc_id                  = var.create_vpc ? aws_vpc.main[0].id : var.existing_vpc_id
  public_subnet_ids       = var.create_vpc ? [aws_subnet.public[0].id, aws_subnet.public[1].id] : var.existing_public_subnet_ids
  private_subnet_ids      = var.create_vpc ? [aws_subnet.private[0].id, aws_subnet.private[1].id] : var.existing_private_subnet_ids
  public_route_table_ids  = var.create_vpc ? aws_route_table.public[*].id : var.existing_public_route_table_ids
  private_route_table_ids = var.create_vpc ? aws_route_table.private[*].id : var.existing_private_route_table_ids
  nat_gateway_enabled     = var.enable_nat_gateway && length(local.public_subnet_ids) > 0 && length(local.private_route_table_ids) > 0
}

################################################################################
# VPC
################################################################################

resource "aws_vpc" "main" {
  count = var.create_vpc ? 1 : 0

  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "thinkwork-${var.stage}-vpc"
  }
}

################################################################################
# Internet Gateway
################################################################################

resource "aws_internet_gateway" "main" {
  count = var.create_vpc ? 1 : 0

  vpc_id = aws_vpc.main[0].id

  tags = {
    Name = "thinkwork-${var.stage}-igw"
  }
}

################################################################################
# Subnets
################################################################################

resource "aws_subnet" "public" {
  count = var.create_vpc ? length(var.availability_zones) : 0

  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = cidrsubnet(var.cidr_block, 6, count.index)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "thinkwork-${var.stage}-pub-${var.availability_zones[count.index]}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  count = var.create_vpc ? length(var.availability_zones) : 0

  vpc_id            = aws_vpc.main[0].id
  cidr_block        = cidrsubnet(var.cidr_block, 6, count.index + length(var.availability_zones))
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "thinkwork-${var.stage}-priv-${var.availability_zones[count.index]}"
    Tier = "private"
  }
}

################################################################################
# Route Tables — Public
################################################################################

resource "aws_route_table" "public" {
  count = var.create_vpc ? length(var.availability_zones) : 0

  vpc_id = aws_vpc.main[0].id

  tags = {
    Name = "thinkwork-${var.stage}-pub-rt-${var.availability_zones[count.index]}"
  }
}

resource "aws_route" "public_igw" {
  count = var.create_vpc ? length(var.availability_zones) : 0

  route_table_id         = aws_route_table.public[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main[0].id
}

resource "aws_route_table_association" "public" {
  count = var.create_vpc ? length(var.availability_zones) : 0

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[count.index].id
}

################################################################################
# Route Tables — Private
################################################################################

resource "aws_route_table" "private" {
  count = var.create_vpc ? length(var.availability_zones) : 0

  vpc_id = aws_vpc.main[0].id

  tags = {
    Name = "thinkwork-${var.stage}-priv-rt-${var.availability_zones[count.index]}"
  }
}

resource "aws_route_table_association" "private" {
  count = var.create_vpc ? length(var.availability_zones) : 0

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

################################################################################
# Optional NAT Gateway
################################################################################

resource "aws_eip" "nat" {
  count = local.nat_gateway_enabled ? 1 : 0

  domain = "vpc"

  tags = {
    Name = "thinkwork-${var.stage}-nat-eip"
  }
}

resource "aws_nat_gateway" "main" {
  count = local.nat_gateway_enabled ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = local.public_subnet_ids[0]

  tags = {
    Name = "thinkwork-${var.stage}-nat"
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route" "private_nat" {
  for_each = local.nat_gateway_enabled ? toset(local.private_route_table_ids) : toset([])

  route_table_id         = each.key
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[0].id
}

################################################################################
# Default Route Table
################################################################################

resource "aws_default_route_table" "main" {
  count = var.create_vpc ? 1 : 0

  default_route_table_id = aws_vpc.main[0].default_route_table_id

  tags = {
    Name = "thinkwork-${var.stage}-main-rt"
  }
}
