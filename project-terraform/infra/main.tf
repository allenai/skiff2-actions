terraform {
  required_version = ">= 1.13"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  backend "gcs" {
    bucket = "" # Set via -backend-config during terraform init
    prefix = "terraform/infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

data "google_project" "project" {
  project_id = var.project_id
}

resource "google_project_iam_member" "cloud_run_secret_access" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

locals {
  project_name = trimprefix(var.project_id, "ai2-skiff2-")

  domain_families = {
    allenai     = "allen.ai"
    apps        = "apps.allenai.org"
    pandajungle = "pandajungle.org"
  }

  primary_domain_key = "pandajungle"

  # Base domains for this project (e.g., "myapp.allen.ai")
  base_domains = { for key, domain in local.domain_families : key => "${local.project_name}.${domain}" }

  # All backend NEG IDs, keyed by backend name
  all_backends = merge(
    { for key, neg in google_compute_region_network_endpoint_group.url_mask : "url-mask-${key}" => neg.id },
    { "default" = google_compute_region_network_endpoint_group.default_service.id },
    { for key, neg in google_compute_region_network_endpoint_group.branch_default : "branch-${key}" => neg.id },
    { for key, neg in google_compute_region_network_endpoint_group.custom_domain : "custom-${local.custom_domain_keys[key]}" => neg.id },
  )

  # Token used in resource names for each custom domain. Short domains keep the
  # dotted-to-dashed form so their existing resources aren't recreated; domains
  # whose names would exceed GCP's 63-char limit fall back to a stable md5 hash.
  custom_domain_keys = {
    for domain, service in var.custom_domain_mappings :
    domain => (
      max(
        length("${local.project_name}-custom-${service.service_name}-${replace(domain, ".", "-")}-neg"),
        length("${local.project_name}-cert-${replace(domain, ".", "-")}"),
        length("${local.project_name}-entry-${replace(domain, ".", "-")}"),
        length("default-lb-backend-custom-${replace(domain, ".", "-")}"),
      ) <= 63
    ) ? replace(domain, ".", "-") : substr(md5(domain), 0, 10)
  }
}

data "google_compute_global_address" "lb_ip" {
  name    = "${local.project_name}-lb-ip"
  project = var.project_id
}

data "google_compute_security_policy" "cloud_armor" {
  name    = "skiff2-cloud-armor"
  project = var.project_id
}

# Create URL Mask NEGs for base service URL on each domain
# <service>.project.domain to the matching Cloud Run service by name.
resource "google_compute_region_network_endpoint_group" "url_mask" {
  for_each              = local.domain_families
  name                  = "${local.project_name}-${each.key}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id
  cloud_run {
    url_mask = "<service>.${local.base_domains[each.key]}"
  }
}

# Explicit NEG for prod default service (bare domain routing)
resource "google_compute_region_network_endpoint_group" "default_service" {
  name                  = "${local.project_name}-default-${var.default_service}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id
  cloud_run {
    service = "prod-${var.default_service}"
  }
  lifecycle {
    create_before_destroy = true
  }
}

# Explicit NEGs for branch default services (branch bare domain routing)
resource "google_compute_region_network_endpoint_group" "branch_default" {
  for_each              = toset(var.branch_environments)
  name                  = "${local.project_name}-${each.value}-default-${var.default_service}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id
  cloud_run {
    service = "${each.value}-${var.default_service}"
  }
  lifecycle {
    create_before_destroy = true
  }
}

# Explicit NEGs for custom domain mappings
resource "google_compute_region_network_endpoint_group" "custom_domain" {
  for_each              = var.custom_domain_mappings
  name                  = "${local.project_name}-custom-${each.value.service_name}-${local.custom_domain_keys[each.key]}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id
  cloud_run {
    service = each.value.service_name
  }
  lifecycle {
    create_before_destroy = true
  }
}

# URL Map
#
resource "google_compute_url_map" "default" {
  name    = "${local.project_name}-url-map"
  project = var.project_id

  # Unmatched hosts fall through to the `primary_domain_key` URL mask backend
  default_service = "projects/${var.project_id}/global/backendServices/default-lb-backend-url-mask-${local.primary_domain_key}"

  # Route each domain family's wildcard to its URL mask backend
  dynamic "host_rule" {
    for_each = local.domain_families
    content {
      hosts        = ["*.${local.base_domains[host_rule.key]}"]
      path_matcher = "url-mask-${host_rule.key}"
    }
  }

  dynamic "path_matcher" {
    for_each = local.domain_families
    content {
      name            = "url-mask-${path_matcher.key}"
      default_service = "projects/${var.project_id}/global/backendServices/default-lb-backend-url-mask-${path_matcher.key}"
    }
  }

  # Bare domains -> prod default service
  host_rule {
    hosts        = values(local.base_domains)
    path_matcher = "bare-domain"
  }

  path_matcher {
    name            = "bare-domain"
    default_service = "projects/${var.project_id}/global/backendServices/default-lb-backend-default"
  }

  # Branch bare domains -> branch default service
  dynamic "host_rule" {
    for_each = toset(var.branch_environments)
    content {
      hosts        = [for _, d in local.base_domains : "${host_rule.value}.${d}"]
      path_matcher = "branch-${host_rule.value}"
    }
  }

  dynamic "path_matcher" {
    for_each = toset(var.branch_environments)
    content {
      name            = "branch-${path_matcher.value}"
      default_service = "projects/${var.project_id}/global/backendServices/default-lb-backend-branch-${path_matcher.value}"
    }
  }

  # Custom domains -> explicit service backends
  dynamic "host_rule" {
    for_each = var.custom_domain_mappings
    content {
      hosts        = [host_rule.key]
      path_matcher = "custom-${local.custom_domain_keys[host_rule.key]}"
    }
  }

  dynamic "path_matcher" {
    for_each = var.custom_domain_mappings
    content {
      name            = "custom-${local.custom_domain_keys[path_matcher.key]}"
      default_service = "projects/${var.project_id}/global/backendServices/default-lb-backend-custom-${local.custom_domain_keys[path_matcher.key]}"
    }
  }
}

# Wildcard certs and cert map are managed by skiff2.
# Per-project infra only handles custom domain certs.
#
data "google_certificate_manager_certificate_map" "default" {
  name    = "${local.project_name}-wildcard-cert-map"
  project = var.project_id
}

# Individual certs for custom domains (HTTP/LB authorization — no DNS needed)
resource "google_certificate_manager_certificate" "custom" {
  for_each = var.custom_domain_mappings
  name     = "${local.project_name}-cert-${local.custom_domain_keys[each.key]}"
  project  = var.project_id

  managed {
    domains = [each.key]
  }
}

resource "google_certificate_manager_dns_authorization" "custom_domain" {
  for_each = { for key, value in var.custom_domain_mappings : key => value if value.include_dns_authorization_for_external_domains }

  name   = "${local.project_name}-dns-auth-${replace(each.key, ".", "-")}"
  domain = each.key
}

resource "google_certificate_manager_certificate" "custom_domain_with_dns_auth" {
  for_each = google_certificate_manager_dns_authorization.custom_domain

  name = "${local.project_name}-cert-dns-auth-${replace(each.value.domain, ".", "-")}"

  managed {
    domains            = [each.value.domain]
    dns_authorizations = [each.value.id]
  }
}

# Cert map entries — custom domains only (wildcard entries managed by skiff2)
resource "google_certificate_manager_certificate_map_entry" "custom" {
  for_each = var.custom_domain_mappings
  name     = "${local.project_name}-entry-${local.custom_domain_keys[each.key]}"
  project  = var.project_id
  map      = data.google_certificate_manager_certificate_map.default.name
  certificates = concat(
    [google_certificate_manager_certificate.custom[each.key].id],
    lookup(google_certificate_manager_certificate.custom_domain_with_dns_auth, each.key, null) != null
    ? [google_certificate_manager_certificate.custom_domain_with_dns_auth[each.key].id]
  : [])
  hostname = each.key
}


# Load Balancer
#
module "lb-http" {
  source  = "GoogleCloudPlatform/lb-http/google//modules/serverless_negs"
  version = "~> 12.0"

  name    = "default-lb"
  project = var.project_id

  load_balancing_scheme = var.use_classic_load_balancer ? "EXTERNAL" : "EXTERNAL_MANAGED"

  create_address = false
  address        = data.google_compute_global_address.lb_ip.address

  ssl             = true
  certificate_map = data.google_certificate_manager_certificate_map.default.id
  https_redirect  = true

  create_url_map = false
  url_map        = google_compute_url_map.default.self_link

  backends = {
    for key, neg_id in local.all_backends : key => {
      protocol = "HTTPS"

      enable_cdn = var.enable_cdn
      cdn_policy = {
        cache_mode        = "CACHE_ALL_STATIC"
        client_ttl        = 3600
        default_ttl       = 3600
        max_ttl           = 86400
        serve_while_stale = 86400
        cache_key_policy = {
          include_protocol     = false
          include_query_string = true
        }
      }

      security_policy = data.google_compute_security_policy.cloud_armor.self_link

      log_config = {
        enable      = true
        sample_rate = 1.0
      }

      groups = [{ group = neg_id }]

      iap_config = {
        enable = false
      }
    }
  }
}
