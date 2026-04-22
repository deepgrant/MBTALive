variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type        = string
  description = "GCP region for Cloud Run and Artifact Registry"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name"
}

variable "repo_name" {
  type        = string
  description = "Artifact Registry repository name"
}

variable "image_url" {
  type        = string
  description = "Full container image URL including git-SHA tag"
}

variable "domain" {
  type        = string
  description = "Public domain name for the HTTPS load balancer"
}

variable "min_scale" {
  type        = number
  default     = 0
  description = "Minimum Cloud Run instance count"
}

variable "max_scale" {
  type        = number
  default     = 10
  description = "Maximum Cloud Run instance count"
}

variable "cpu" {
  type        = string
  default     = "1"
  description = "CPU limit per Cloud Run instance"
}

variable "memory" {
  type        = string
  default     = "512Mi"
  description = "Memory limit per Cloud Run instance"
}

variable "concurrency" {
  type        = number
  default     = 80
  description = "Maximum concurrent requests per Cloud Run instance"
}

variable "timeout_seconds" {
  type        = number
  default     = 60
  description = "Cloud Run request timeout in seconds"
}
