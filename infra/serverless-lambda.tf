locals {
  snapshot_config = <<-EOC
    mbta-snapshot {
      snapshot-bucket = "${aws_s3_bucket.snapshots.bucket}"
      control-table = "${aws_dynamodb_table.snapshot_control.name}"
      api-secret-arn = "${data.aws_secretsmanager_secret.mbta_api_key.arn}"
      active-ttl = 150 seconds
      provider-limit = 1000
      safe-limit = 800
      burst-capacity = 20
      prediction-batch-size = 10
    }
  EOC
}

resource "aws_lambda_function" "vehicle_refresh" {
  function_name = "${var.service_name}-vehicle-refresh"
  package_type  = "Image"
  image_uri     = var.snapshot_image_url
  architectures = ["arm64"]
  role          = aws_iam_role.snapshot_worker.arn
  timeout       = 30
  memory_size   = 1024

  environment {
    variables = { MBTA_SNAPSHOT_CONFIG = local.snapshot_config }
  }

  reserved_concurrent_executions = 2
}

resource "aws_lambda_function" "board_refresh" {
  function_name = "${var.service_name}-board-refresh"
  package_type  = "Image"
  image_uri     = var.snapshot_image_url
  architectures = ["arm64"]
  role          = aws_iam_role.snapshot_worker.arn
  timeout       = 60
  memory_size   = 2048

  environment {
    variables = { MBTA_SNAPSHOT_CONFIG = local.snapshot_config }
  }

  reserved_concurrent_executions = 1
}

resource "aws_lambda_function" "alert_refresh" {
  function_name = "${var.service_name}-alert-refresh"
  package_type  = "Image"
  image_uri     = var.snapshot_image_url
  architectures = ["arm64"]
  role          = aws_iam_role.snapshot_worker.arn
  timeout       = 30
  memory_size   = 1024

  environment {
    variables = { MBTA_SNAPSHOT_CONFIG = local.snapshot_config }
  }

  reserved_concurrent_executions = 1
}

resource "aws_lambda_function" "reference_refresh" {
  function_name = "${var.service_name}-reference-refresh"
  package_type  = "Image"
  image_uri     = var.snapshot_image_url
  architectures = ["arm64"]
  role          = aws_iam_role.snapshot_worker.arn
  timeout       = 900
  memory_size   = 2048

  environment {
    variables = { MBTA_SNAPSHOT_CONFIG = local.snapshot_config }
  }

  reserved_concurrent_executions = 1
}

resource "aws_lambda_function" "route_activity" {
  function_name = "${var.service_name}-route-activity"
  package_type  = "Image"
  image_uri     = var.snapshot_image_url
  architectures = ["arm64"]
  role          = aws_iam_role.snapshot_activity.arn
  timeout       = 15
  memory_size   = 512

  environment {
    variables = { MBTA_SNAPSHOT_CONFIG = local.snapshot_config }
  }

  reserved_concurrent_executions = 20
}

resource "aws_lambda_function" "snapshot_smoke" {
  function_name = "${var.service_name}-snapshot-smoke"
  package_type  = "Image"
  image_uri     = var.snapshot_image_url
  architectures = ["arm64"]
  role          = aws_iam_role.snapshot_worker.arn
  timeout       = 15
  memory_size   = 512

  environment {
    variables = { MBTA_SNAPSHOT_CONFIG = local.snapshot_config }
  }

  reserved_concurrent_executions = 1
}

resource "aws_cloudwatch_log_group" "snapshot_lambdas" {
  for_each = toset([
    aws_lambda_function.vehicle_refresh.function_name,
    aws_lambda_function.board_refresh.function_name,
    aws_lambda_function.alert_refresh.function_name,
    aws_lambda_function.reference_refresh.function_name,
    aws_lambda_function.route_activity.function_name,
    aws_lambda_function.snapshot_smoke.function_name,
  ])

  name              = "/aws/lambda/${each.value}"
  retention_in_days = 14
}
