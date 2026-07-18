data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "snapshot_worker" {
  name               = "${var.service_name}-snapshot-worker"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role" "snapshot_activity" {
  name               = "${var.service_name}-snapshot-activity"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "snapshot_worker_logs" {
  role       = aws_iam_role.snapshot_worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "snapshot_activity_logs" {
  role       = aws_iam_role.snapshot_activity.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "snapshot_worker" {
  statement {
    sid       = "ListSnapshotObjects"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.snapshots.arn]
  }

  statement {
    sid = "SnapshotObjects"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.snapshots.arn}/*"]
  }

  statement {
    sid = "SnapshotControl"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Scan",
    ]
    resources = [aws_dynamodb_table.snapshot_control.arn]
  }

  statement {
    sid       = "MbtaApiSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [data.aws_secretsmanager_secret.mbta_api_key.arn]
  }
}

resource "aws_iam_role_policy" "snapshot_worker" {
  name   = "snapshot-worker"
  role   = aws_iam_role.snapshot_worker.id
  policy = data.aws_iam_policy_document.snapshot_worker.json
}

data "aws_iam_policy_document" "snapshot_activity" {
  statement {
    sid       = "ListInitialSnapshotObjects"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.snapshots.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        "api/*",
        "internal/vehicles/latest",
        "internal/reference/*",
      ]
    }
  }

  statement {
    sid = "PublicSnapshotInitialization"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = [
      "${aws_s3_bucket.snapshots.arn}/api/*",
      "${aws_s3_bucket.snapshots.arn}/internal/vehicles/latest",
      "${aws_s3_bucket.snapshots.arn}/internal/reference/*",
    ]
  }

  statement {
    sid = "RouteActivity"
    actions = [
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.snapshot_control.arn]
  }
}

resource "aws_iam_role_policy" "snapshot_activity" {
  name   = "snapshot-activity"
  role   = aws_iam_role.snapshot_activity.id
  policy = data.aws_iam_policy_document.snapshot_activity.json
}

data "aws_iam_policy_document" "states_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "snapshot_states" {
  name               = "${var.service_name}-snapshot-states"
  assume_role_policy = data.aws_iam_policy_document.states_assume.json
}

resource "aws_iam_role_policy" "snapshot_states" {
  name = "invoke-refresh-lambdas"
  role = aws_iam_role.snapshot_states.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["lambda:InvokeFunction"]
      Resource = [
        aws_lambda_function.vehicle_refresh.arn,
        aws_lambda_function.board_refresh.arn,
      ]
    }]
  })
}

data "aws_iam_policy_document" "events_states_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "events_start_snapshot_cycle" {
  name               = "${var.service_name}-start-snapshot-cycle"
  assume_role_policy = data.aws_iam_policy_document.events_states_assume.json
}

resource "aws_iam_role_policy" "events_start_snapshot_cycle" {
  name = "start-state-machine"
  role = aws_iam_role.events_start_snapshot_cycle.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["states:StartExecution"]
      Resource = aws_sfn_state_machine.snapshot_cycle.arn
    }]
  })
}
