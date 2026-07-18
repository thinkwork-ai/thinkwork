variable "region" {
  description = "AWS region for the isolated THINK-316 proof."
  type        = string
  default     = "us-east-1"
}

variable "stage" {
  description = "Proof stage suffix."
  type        = string
  default     = "dev"
}

variable "lambda_zips_dir" {
  description = "Absolute directory containing the three focused proof Lambda zips."
  type        = string
}
