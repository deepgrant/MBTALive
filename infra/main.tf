# Shared account resources for the serverless production stack.

data "aws_route53_zone" "main" {
  name = var.zone
}

resource "aws_ecr_repository" "snapshot" {
  name                 = "${var.repo_name}/${var.service_name}-snapshot"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Created once by the Gradle seedApiKey task. The value never enters state.
data "aws_secretsmanager_secret" "mbta_api_key" {
  name = "mbta-api-key"
}

# CloudFront requires its viewer certificate in us-east-1 regardless of the
# region used for Lambda, S3, and DynamoDB.
resource "aws_acm_certificate" "main" {
  provider          = aws.use1
  domain_name       = var.domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "main" {
  provider                = aws.use1
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}
