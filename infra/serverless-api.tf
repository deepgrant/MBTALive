resource "aws_apigatewayv2_api" "snapshot_control" {
  name          = "${var.service_name}-snapshot-control"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["content-type"]
    allow_methods = ["PUT", "OPTIONS"]
    allow_origins = ["https://${var.domain}", "http://localhost:4200"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "route_activity" {
  api_id                 = aws_apigatewayv2_api.snapshot_control.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.route_activity.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "route_activity" {
  api_id    = aws_apigatewayv2_api.snapshot_control.id
  route_key = "PUT /api/control/routes/{routeId}/activity"
  target    = "integrations/${aws_apigatewayv2_integration.route_activity.id}"
}

resource "aws_apigatewayv2_stage" "snapshot_control" {
  api_id      = aws_apigatewayv2_api.snapshot_control.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

resource "aws_lambda_permission" "route_activity_api" {
  statement_id  = "AllowSnapshotControlApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.route_activity.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.snapshot_control.execution_arn}/*/*"
}
