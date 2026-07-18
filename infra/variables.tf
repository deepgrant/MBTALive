variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "default"
}

variable "aws_account_id" {
  type = string
}

variable "service_name" {
  type = string
}

variable "repo_name" {
  type = string
}

variable "snapshot_image_url" {
  type        = string
  description = "Full immutable ECR image URL for the snapshot Lambda functions"
}

variable "zone" {
  type        = string
  description = "Route 53 hosted zone (parent domain)"
}

variable "domain" {
  type        = string
  description = "Production application domain (for example mbta.critmind.com)"
}
