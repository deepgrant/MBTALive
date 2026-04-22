output "lb_ip" {
  value       = google_compute_global_address.lb_ip.address
  description = "Set a DNS A record: ${var.domain} → this IP, then run: ./gradlew checkCert"
}

output "cloud_run_url" {
  value       = google_cloud_run_v2_service.backend.uri
  description = "Direct Cloud Run URL — internal use only; all public traffic goes through the LB"
}

output "frontend_bucket" {
  value       = google_storage_bucket.frontend.name
  description = "GCS bucket serving the Angular SPA"
}

output "image_deployed" {
  value       = var.image_url
  description = "Container image URL deployed in this run"
}
