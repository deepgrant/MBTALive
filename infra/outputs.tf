output "app_url" {
  value       = "https://${var.domain}/"
  description = "Production URL for the MBTA Tracker app"
}

output "cloudfront_domain" {
  value       = aws_cloudfront_distribution.serverless.domain_name
  description = "CloudFront distribution hostname"
}

output "serverless_distribution_id" {
  value       = aws_cloudfront_distribution.serverless.id
  description = "CloudFront distribution ID for entry-point-only invalidations"
}

output "snapshot_image_deployed" {
  value       = var.snapshot_image_url
  description = "Immutable Lambda image URL deployed in this run"
}

output "snapshot_bucket_name" {
  value       = aws_s3_bucket.snapshots.bucket
  description = "Private generated API snapshot bucket"
}

output "frontend_bucket_name" {
  value       = aws_s3_bucket.serverless_frontend.bucket
  description = "Private Angular frontend bucket"
}

output "snapshot_control_api" {
  value       = aws_apigatewayv2_api.snapshot_control.api_endpoint
  description = "API Gateway endpoint for route activity heartbeats"
}
