locals {
  snapshot_functions = {
    vehicle   = aws_lambda_function.vehicle_refresh.function_name
    board     = aws_lambda_function.board_refresh.function_name
    alerts    = aws_lambda_function.alert_refresh.function_name
    reference = aws_lambda_function.reference_refresh.function_name
    activity  = aws_lambda_function.route_activity.function_name
    smoke     = aws_lambda_function.snapshot_smoke.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "snapshot_lambda_errors" {
  for_each = local.snapshot_functions

  alarm_name          = "${var.service_name}-${each.key}-lambda-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = each.value }
}

resource "aws_cloudwatch_metric_alarm" "snapshot_state_machine_failures" {
  alarm_name          = "${var.service_name}-snapshot-cycle-failures"
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { StateMachineArn = aws_sfn_state_machine.snapshot_cycle.arn }
}

resource "aws_cloudwatch_metric_alarm" "mbta_429" {
  alarm_name          = "${var.service_name}-mbta-429"
  namespace           = "MBTA/Snapshots"
  metric_name         = "MbtaRequest"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { status = "429" }
}

resource "aws_cloudwatch_metric_alarm" "mbta_remaining_low" {
  alarm_name          = "${var.service_name}-mbta-remaining-low"
  namespace           = "MBTA/Snapshots"
  metric_name         = "MbtaRemaining"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 100
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
}

locals {
  freshness_thresholds = {
    vehicles = 30
    boards   = 90
    alerts   = 300
  }
}

resource "aws_cloudwatch_metric_alarm" "snapshot_stale" {
  for_each = local.freshness_thresholds

  alarm_name          = "${var.service_name}-${each.key}-snapshot-stale"
  namespace           = "MBTA/Snapshots"
  metric_name         = "SnapshotAgeSeconds"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = each.value
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { dataset = each.key }
}

resource "aws_cloudwatch_metric_alarm" "snapshot_lambda_throttles" {
  for_each = local.snapshot_functions

  alarm_name          = "${var.service_name}-${each.key}-lambda-throttles"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = each.value }
}

resource "aws_cloudwatch_metric_alarm" "activity_api_5xx" {
  alarm_name          = "${var.service_name}-activity-api-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    ApiId = aws_apigatewayv2_api.snapshot_control.id
    Stage = aws_apigatewayv2_stage.snapshot_control.name
  }
}

resource "aws_cloudwatch_metric_alarm" "snapshot_refresh_failures" {
  for_each = toset(["vehicles", "alerts", "references", "routes"])

  alarm_name          = "${var.service_name}-${each.value}-refresh-failures"
  namespace           = "MBTA/Snapshots"
  metric_name         = "SnapshotRefreshFailure"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { dataset = each.value }
}

resource "aws_cloudwatch_metric_alarm" "board_batch_failures" {
  alarm_name          = "${var.service_name}-board-batch-failures"
  namespace           = "MBTA/Snapshots"
  metric_name         = "BoardBatchFailure"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "snapshot_publication_failures" {
  alarm_name          = "${var.service_name}-snapshot-publication-failures"
  namespace           = "MBTA/Snapshots"
  metric_name         = "S3PublicationFailure"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
