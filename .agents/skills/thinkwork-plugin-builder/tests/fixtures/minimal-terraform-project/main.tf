terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "aws_s3_bucket" "lakehouse_raw" {
  bucket = var.raw_bucket_name
}

resource "aws_glue_catalog_database" "lakehouse" {
  name = var.glue_database_name
}
