resource "aws_cloudfront_origin_access_control" "serverless" {
  name                              = "${var.service_name}-serverless-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.service_name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (!request.uri.startsWith('/api/') && request.uri !== '/api' && !request.uri.includes('.')) {
        request.uri = '/index.html';
      }
      return request;
    }
  JS
}

resource "aws_cloudfront_cache_policy" "snapshots" {
  name        = "${var.service_name}-snapshots"
  min_ttl     = 0
  default_ttl = 10
  max_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}

resource "aws_cloudfront_cache_policy" "control_disabled" {
  name        = "${var.service_name}-control-disabled"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}

resource "aws_cloudfront_origin_request_policy" "control" {
  name = "${var.service_name}-control"
  cookies_config { cookie_behavior = "none" }
  headers_config {
    header_behavior = "whitelist"
    headers { items = ["content-type", "origin"] }
  }
  query_strings_config { query_string_behavior = "none" }
}

resource "aws_cloudfront_distribution" "serverless" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [var.domain]

  origin {
    domain_name              = aws_s3_bucket.serverless_frontend.bucket_regional_domain_name
    origin_id                = "frontend-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.serverless.id
  }

  origin {
    domain_name              = aws_s3_bucket.snapshots.bucket_regional_domain_name
    origin_id                = "snapshot-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.serverless.id
  }

  origin {
    domain_name = replace(aws_apigatewayv2_api.snapshot_control.api_endpoint, "https://", "")
    origin_id   = "snapshot-control-api"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "frontend-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/control/*"
    target_origin_id         = "snapshot-control-api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = aws_cloudfront_cache_policy.control_disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.control.id
  }

  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "snapshot-s3"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.snapshots.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "serverless_frontend_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.serverless_frontend.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.serverless.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "serverless_frontend" {
  bucket = aws_s3_bucket.serverless_frontend.id
  policy = data.aws_iam_policy_document.serverless_frontend_bucket.json
}

data "aws_iam_policy_document" "snapshot_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.snapshots.arn}/api/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.serverless.arn]
    }
  }

  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.snapshots.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.serverless.arn]
    }
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["api/*"]
    }
  }
}

resource "aws_s3_bucket_policy" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  policy = data.aws_iam_policy_document.snapshot_bucket.json
}

resource "aws_route53_record" "serverless_a" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.serverless.domain_name
    zone_id                = aws_cloudfront_distribution.serverless.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "serverless_aaaa" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.serverless.domain_name
    zone_id                = aws_cloudfront_distribution.serverless.hosted_zone_id
    evaluate_target_health = false
  }
}
