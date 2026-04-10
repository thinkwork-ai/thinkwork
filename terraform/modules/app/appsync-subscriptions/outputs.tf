output "graphql_api_id" {
  description = "AppSync GraphQL API ID"
  value       = aws_appsync_graphql_api.subscriptions.id
}

output "graphql_api_url" {
  description = "AppSync GraphQL endpoint URL (used by backend to push notifications)"
  value       = aws_appsync_graphql_api.subscriptions.uris["GRAPHQL"]
}

output "graphql_realtime_url" {
  description = "AppSync realtime WebSocket URL (used by frontend subscription clients)"
  value       = aws_appsync_graphql_api.subscriptions.uris["REALTIME"]
}

output "graphql_api_key" {
  description = "AppSync API key"
  value       = aws_appsync_api_key.main.key
  sensitive   = true
}
