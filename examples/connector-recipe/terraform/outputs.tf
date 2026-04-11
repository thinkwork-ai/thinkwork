output "webhook_url" {
  description = "API Gateway endpoint — register this URL as the webhook destination in the external service"
  value       = "${aws_apigatewayv2_stage.default.invoke_url}/webhook"
}
