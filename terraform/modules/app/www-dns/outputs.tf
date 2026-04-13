output "certificate_arn" {
  description = "ACM certificate ARN (us-east-1) covering apex + www. Pass this to the static-site module via www_certificate_arn."
  value       = aws_acm_certificate_validation.www.certificate_arn
}

output "www_redirect_distribution_id" {
  description = "CloudFront distribution ID for the www→apex redirect"
  value       = aws_cloudfront_distribution.www_redirect.id
}

output "www_redirect_distribution_domain" {
  description = "CloudFront distribution domain for the www→apex redirect"
  value       = aws_cloudfront_distribution.www_redirect.domain_name
}
