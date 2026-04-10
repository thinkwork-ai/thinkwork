variable "stage" {
  description = "Deployment stage"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "user_pool_id" {
  description = "Cognito user pool ID for authentication"
  type        = string
}

variable "subscription_schema" {
  description = "GraphQL schema containing only Subscription + notification Mutation types. This is a subscription-only fragment, NOT the full product schema."
  type        = string
}

variable "custom_domain" {
  description = "Custom domain for the AppSync API (e.g. subscriptions.thinkwork.ai). Leave empty to skip."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate ARN for the custom domain (required when custom_domain is set)"
  type        = string
  default     = ""
}
