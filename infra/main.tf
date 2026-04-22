# ── APIs ──────────────────────────────────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "certificatemanager.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ── Artifact Registry ─────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "docker" {
  depends_on    = [google_project_service.apis]
  repository_id = var.repo_name
  location      = var.region
  format        = "DOCKER"
}

# ── Secret Manager ────────────────────────────────────────────────────────────
# Manages the secret resource and IAM only. The secret value (MBTA_API_KEY) is
# seeded separately by the Gradle seedApiKey task and never enters tofu state.

resource "google_secret_manager_secret" "mbta_api_key" {
  depends_on = [google_project_service.apis]
  secret_id  = "mbta-api-key"
  replication {
    auto {}
  }
}

data "google_compute_default_service_account" "default" {
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "cr_sa_access" {
  secret_id = google_secret_manager_secret.mbta_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_compute_default_service_account.default.email}"
}

# ── Cloud Run service ─────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "backend" {
  depends_on = [
    google_artifact_registry_repository.docker,
    google_secret_manager_secret_iam_member.cr_sa_access,
  ]
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    scaling {
      min_instance_count = var.min_scale
      max_instance_count = var.max_scale
    }
    max_instance_request_concurrency = var.concurrency
    timeout                          = "${var.timeout_seconds}s"

    containers {
      image = var.image_url

      ports {
        container_port = 8080
      }

      env {
        name = "MBTA_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.mbta_api_key.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        startup_cpu_boost = true
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 6
      }

      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds = 30
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Frontend GCS bucket ───────────────────────────────────────────────────────

resource "google_storage_bucket" "frontend" {
  depends_on                  = [google_project_service.apis]
  name                        = "${var.project_id}-frontend"
  location                    = var.region
  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }
}

resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.frontend.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# ── Load balancer ─────────────────────────────────────────────────────────────

resource "google_compute_global_address" "lb_ip" {
  depends_on = [google_project_service.apis]
  name       = "mbta-lb-ip"
}

resource "google_compute_region_network_endpoint_group" "cr_neg" {
  depends_on            = [google_cloud_run_v2_service.backend]
  name                  = "${var.service_name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.backend.name
  }
}

resource "google_compute_backend_service" "api" {
  depends_on            = [google_project_service.apis]
  name                  = "${var.service_name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.cr_neg.id
  }
}

resource "google_compute_backend_bucket" "frontend" {
  name        = "frontend-backend"
  bucket_name = google_storage_bucket.frontend.name
}

resource "google_compute_url_map" "main" {
  name            = "mbta-url-map"
  default_service = google_compute_backend_bucket.frontend.id

  host_rule {
    hosts        = [var.domain]
    path_matcher = "mbta-paths"
  }

  path_matcher {
    name            = "mbta-paths"
    default_service = google_compute_backend_bucket.frontend.id

    path_rule {
      paths   = ["/api", "/api/*", "/health"]
      service = google_compute_backend_service.api.id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "cert" {
  depends_on = [google_project_service.apis]
  name       = "mbta-cert"

  managed {
    domains = [var.domain]
  }
}

resource "google_compute_target_https_proxy" "https" {
  name             = "mbta-https-proxy"
  url_map          = google_compute_url_map.main.id
  ssl_certificates = [google_compute_managed_ssl_certificate.cert.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "mbta-https-rule"
  ip_address            = google_compute_global_address.lb_ip.address
  port_range            = "443"
  target                = google_compute_target_https_proxy.https.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# HTTP → HTTPS redirect

resource "google_compute_url_map" "http_redirect" {
  name = "mbta-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "http" {
  name    = "mbta-http-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "mbta-http-rule"
  ip_address            = google_compute_global_address.lb_ip.address
  port_range            = "80"
  target                = google_compute_target_http_proxy.http.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
