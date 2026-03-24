output "service_name" {
  value = google_cloud_run_v2_service.service.name
}

output "service_location" {
  value = google_cloud_run_v2_service.service.location
}

output "service_project" {
  value = google_cloud_run_v2_service.service.project
}
