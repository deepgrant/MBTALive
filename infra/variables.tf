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

variable "image_url" {
  type        = string
  description = "Full ECR image URL including git-SHA tag"
}

variable "domain" {
  type = string
}

variable "cpu" {
  type        = string
  default     = "256"
  description = "ECS task CPU units (256 = 0.25 vCPU)"
}

variable "memory" {
  type        = string
  default     = "512"
  description = "ECS task memory in MiB"
}

variable "min_tasks" {
  type    = number
  default = 1
}

variable "max_tasks" {
  type    = number
  default = 10
}

variable "container_port" {
  type    = number
  default = 8080
}
