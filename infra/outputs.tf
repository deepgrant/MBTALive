output "app_url" {
  value       = "https://${var.domain}/MBTA/"
  description = "Public URL for the MBTA Tracker app"
}

output "api_gateway_domain" {
  value       = aws_apigatewayv2_domain_name.main.domain_name_configuration[0].target_domain_name
  description = "API Gateway regional domain name (aliased by Route 53)"
}

output "alb_dns" {
  value       = aws_lb.main.dns_name
  description = "ALB DNS — receives traffic from API Gateway only; not publicly advertised"
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.app.repository_url
  description = "ECR repository URL for image pushes"
}

output "image_deployed" {
  value       = var.image_url
  description = "Container image URL deployed in this run"
}
