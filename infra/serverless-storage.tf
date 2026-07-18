resource "aws_s3_bucket" "serverless_frontend" {
  bucket = "${var.service_name}-${var.aws_account_id}-frontend"
}

resource "aws_s3_bucket" "snapshots" {
  bucket = "${var.service_name}-${var.aws_account_id}-snapshots"
}

resource "aws_s3_bucket_public_access_block" "serverless_frontend" {
  bucket                  = aws_s3_bucket.serverless_frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "snapshots" {
  bucket                  = aws_s3_bucket.snapshots.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "serverless_frontend" {
  bucket = aws_s3_bucket.serverless_frontend.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "snapshots" {
  bucket = aws_s3_bucket.snapshots.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_dynamodb_table" "snapshot_control" {
  name         = "${var.service_name}-snapshot-control"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}
