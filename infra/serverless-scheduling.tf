locals {
  vehicle_invoke = {
    Type     = "Task"
    Resource = "arn:aws:states:::lambda:invoke"
    Parameters = {
      FunctionName = aws_lambda_function.vehicle_refresh.arn
      Payload      = { action = "vehicle-refresh" }
    }
  }

  vehicle_task = merge(local.vehicle_invoke, {
    OutputPath = "$.Payload"
    End        = true
  })

  board_task = {
    Type     = "Task"
    Resource = "arn:aws:states:::lambda:invoke"
    Parameters = {
      FunctionName = aws_lambda_function.board_refresh.arn
      Payload      = { action = "board-refresh" }
    }
    OutputPath = "$.Payload"
    End        = true
  }

  cycle_branches = [
    {
      StartAt = "Refresh vehicle at 00"
      States = {
        "Refresh vehicle at 00" = merge(local.vehicle_invoke, {
          ResultPath = "$.vehicle"
          Next       = "Refresh board at 00"
        })
        "Refresh board at 00" = local.board_task
      }
    },
    {
      StartAt = "Wait 10 seconds"
      States = {
        "Wait 10 seconds"       = { Type = "Wait", Seconds = 10, Next = "Refresh vehicle at 10" }
        "Refresh vehicle at 10" = local.vehicle_task
      }
    },
    {
      StartAt = "Wait 20 seconds"
      States = {
        "Wait 20 seconds"       = { Type = "Wait", Seconds = 20, Next = "Refresh vehicle at 20" }
        "Refresh vehicle at 20" = local.vehicle_task
      }
    },
    {
      StartAt = "Wait 30 seconds"
      States = {
        "Wait 30 seconds" = { Type = "Wait", Seconds = 30, Next = "Refresh vehicle at 30" }
        "Refresh vehicle at 30" = merge(local.vehicle_invoke, {
          ResultPath = "$.vehicle"
          Next       = "Refresh board at 30"
        })
        "Refresh board at 30" = local.board_task
      }
    },
    {
      StartAt = "Wait 40 seconds"
      States = {
        "Wait 40 seconds"       = { Type = "Wait", Seconds = 40, Next = "Refresh vehicle at 40" }
        "Refresh vehicle at 40" = local.vehicle_task
      }
    },
    {
      StartAt = "Wait 50 seconds"
      States = {
        "Wait 50 seconds"       = { Type = "Wait", Seconds = 50, Next = "Refresh vehicle at 50" }
        "Refresh vehicle at 50" = local.vehicle_task
      }
    },
  ]
}

resource "aws_sfn_state_machine" "snapshot_cycle" {
  name     = "${var.service_name}-snapshot-cycle"
  role_arn = aws_iam_role.snapshot_states.arn
  type     = "STANDARD"

  definition = jsonencode({
    Comment = "Sub-minute active-route MBTA snapshot refresh"
    StartAt = "Refresh cycle"
    States = {
      "Refresh cycle" = {
        Type     = "Parallel"
        Branches = local.cycle_branches
        End      = true
      }
    }
  })
}

resource "aws_cloudwatch_event_rule" "snapshot_cycle" {
  name                = "${var.service_name}-snapshot-cycle"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "snapshot_cycle" {
  rule     = aws_cloudwatch_event_rule.snapshot_cycle.name
  arn      = aws_sfn_state_machine.snapshot_cycle.arn
  role_arn = aws_iam_role.events_start_snapshot_cycle.arn
  input    = jsonencode({ source = "mbta.snapshot-cycle" })
}

locals {
  scheduled_refreshes = {
    alerts = {
      expression = "rate(2 minutes)"
      function   = aws_lambda_function.alert_refresh
      action     = "alert-refresh"
    }
    references = {
      expression = "rate(24 hours)"
      function   = aws_lambda_function.reference_refresh
      action     = "reference-refresh"
    }
    routes = {
      expression = "rate(6 hours)"
      function   = aws_lambda_function.reference_refresh
      action     = "route-refresh"
    }
  }
}

resource "aws_cloudwatch_event_rule" "scheduled_refresh" {
  for_each = local.scheduled_refreshes

  name                = "${var.service_name}-${each.key}-refresh"
  schedule_expression = each.value.expression
}

resource "aws_cloudwatch_event_target" "scheduled_refresh" {
  for_each = local.scheduled_refreshes

  rule  = aws_cloudwatch_event_rule.scheduled_refresh[each.key].name
  arn   = each.value.function.arn
  input = jsonencode({ action = each.value.action })
}

resource "aws_lambda_permission" "scheduled_refresh" {
  for_each = local.scheduled_refreshes

  statement_id  = "AllowEventBridge${title(each.key)}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scheduled_refresh[each.key].arn
}
