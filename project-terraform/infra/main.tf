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
    { for key, neg in google_compute_region_network_endpoint_group.custom_domain : "custom-${replace(key, ".", "-")}" => neg.id },
  )
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
}

# Explicit NEGs for custom domain mappings
resource "google_compute_region_network_endpoint_group" "custom_domain" {
  for_each              = var.custom_domain_mappings
  name                  = "${local.project_name}-custom-${replace(each.key, ".", "-")}-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id
  cloud_run {
    service = each.value
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
      path_matcher = "custom-${replace(host_rule.key, ".", "-")}"
    }
  }

  dynamic "path_matcher" {
    for_each = var.custom_domain_mappings
    content {
      name            = "custom-${replace(path_matcher.key, ".", "-")}"
      default_service = "projects/${var.project_id}/global/backendServices/default-lb-backend-custom-${replace(path_matcher.key, ".", "-")}"
    }
  }
  lifecycle {
    create_before_destroy = true
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
  name     = "${local.project_name}-cert-${replace(each.key, ".", "-")}"
  project  = var.project_id

  managed {
    domains = [each.key]
  }
}

# Cert map entries — custom domains only (wildcard entries managed by skiff2)
resource "google_certificate_manager_certificate_map_entry" "custom" {
  for_each     = var.custom_domain_mappings
  name         = "${local.project_name}-entry-${replace(each.key, ".", "-")}"
  project      = var.project_id
  map          = data.google_certificate_manager_certificate_map.default.name
  certificates = [google_certificate_manager_certificate.custom[each.key].id]
  hostname     = each.key
}


# Load Balancer
#
# Previously provisioned via the GoogleCloudPlatform/lb-http//serverless_negs
# module. Inlined here for clarity and to drop an indirection. The `moved`
# blocks below re-parent the existing state entries so `terraform apply` is
# a no-op against GCP.
resource "google_compute_backend_service" "default" {
  provider = google-beta
  for_each = local.all_backends

  project = var.project_id
  name    = "default-lb-backend-${each.key}"

  load_balancing_scheme = var.use_classic_load_balancer ? "EXTERNAL" : "EXTERNAL_MANAGED"

  port_name = "http"
  protocol  = "HTTPS"

  enable_cdn       = false

  security_policy = data.google_compute_security_policy.cloud_armor.self_link

  backend {
    group = each.value
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  iap {
    enabled = false
  }
}

resource "google_compute_url_map" "https_redirect" {
  project = var.project_id
  name    = "default-lb-https-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "default" {
  project = var.project_id
  name    = "default-lb-http-proxy"
  url_map = google_compute_url_map.https_redirect.self_link
}

resource "google_compute_target_https_proxy" "default" {
  project         = var.project_id
  name            = "default-lb-https-proxy"
  url_map         = google_compute_url_map.default.self_link
  certificate_map = "//certificatemanager.googleapis.com/${data.google_certificate_manager_certificate_map.default.id}"
  quic_override   = "NONE"
}

resource "google_compute_global_forwarding_rule" "http" {
  provider              = google-beta
  project               = var.project_id
  name                  = "default-lb"
  target                = google_compute_target_http_proxy.default.self_link
  ip_address            = data.google_compute_global_address.lb_ip.address
  port_range            = "80"
  load_balancing_scheme = var.use_classic_load_balancer ? "EXTERNAL" : "EXTERNAL_MANAGED"
}

resource "google_compute_global_forwarding_rule" "https" {
  provider              = google-beta
  project               = var.project_id
  name                  = "default-lb-https"
  target                = google_compute_target_https_proxy.default.self_link
  ip_address            = data.google_compute_global_address.lb_ip.address
  port_range            = "443"
  load_balancing_scheme = var.use_classic_load_balancer ? "EXTERNAL" : "EXTERNAL_MANAGED"
}

# State migration: preserve existing GCP resources by re-parenting them from
# the removed `module.lb-http` into the inlined resources above.
moved {
  from = module.lb-http.google_compute_backend_service.default
  to   = google_compute_backend_service.default
}

moved {
  from = module.lb-http.google_compute_url_map.https_redirect[0]
  to   = google_compute_url_map.https_redirect
}

moved {
  from = module.lb-http.google_compute_target_http_proxy.default[0]
  to   = google_compute_target_http_proxy.default
}

moved {
  from = module.lb-http.google_compute_target_https_proxy.default[0]
  to   = google_compute_target_https_proxy.default
}

moved {
  from = module.lb-http.google_compute_global_forwarding_rule.http[0]
  to   = google_compute_global_forwarding_rule.http
}

moved {
  from = module.lb-http.google_compute_global_forwarding_rule.https[0]
  to   = google_compute_global_forwarding_rule.https
}
