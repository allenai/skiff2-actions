output "custom_domain_dns_authorizations" {
  value = [for authorization in google_certificate_manager_dns_authorization.custom_domain : authorization.dns_resource_record]
}
