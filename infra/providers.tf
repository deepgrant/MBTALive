terraform {
  required_version = ">= 1.8"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # bucket and prefix are supplied at init time via -backend-config flags in
  # the Gradle tofuInit task — keeps the project ID out of checked-in files.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
