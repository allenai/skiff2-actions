output "custom_domain_dns_authorizations" {
  value = google_certificate_manager_dns_authorization.custom_domain[*].dns_resource_record
}
